import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTION_LANGUAGES, getStoredCaptionLang, storeCaptionLang } from '../utils/captionLanguages';

const SpeechRecognitionImpl =
    typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

export const CAPTIONS_SUPPORTED = Boolean(SpeechRecognitionImpl);

// How long a speaker's caption line stays on screen after its last update.
const CAPTION_LINGER_MS = 6000;

/**
 * useCaptions — live captions via the browser's native Web Speech API.
 *
 * Design notes:
 * - There is no way to feed a specific MediaStream into SpeechRecognition;
 *   it always listens to whatever the browser treats as the current
 *   default input. In practice this is the same mic already granted via
 *   getUserMedia, so this only ever transcribes the LOCAL user's own voice.
 * - Each participant runs recognition locally and broadcasts finalized
 *   (and, for responsiveness, in-progress) lines over the existing
 *   Socket.IO room channel — mirroring how chat/whiteboard/annotations
 *   are relayed. The server never sees or stores audio, only text.
 * - `continuous: true` still gets silently ended by the browser after
 *   periods of silence in most implementations. onend restarts it
 *   automatically as long as the user hasn't explicitly turned captions
 *   off (tracked via shouldRunRef, not the `captionsEnabled` state, to
 *   avoid a stale closure inside the recognition object's own handlers).
 */
export function useCaptions({ socket, roomId, localSocketId, localName }) {
    const [captionsEnabled, setCaptionsEnabled] = useState(false);
    const [captionLang, setCaptionLangState] = useState(getStoredCaptionLang);
    // socketId -> { name, text, isFinal, updatedAt }
    const [captionsBySpeaker, setCaptionsBySpeaker] = useState({});

    const recognitionRef = useRef(null);
    const shouldRunRef = useRef(false);
    const cleanupTimersRef = useRef({});

    // Refs so the recognition object's long-lived handlers always see the
    // latest socketId/name without needing to recreate the recognition
    // instance (same pattern used throughout usePeerConnections/Room.jsx).
    const localSocketIdRef = useRef(localSocketId);
    const localNameRef = useRef(localName);
    // recognition.lang is only read at .start() time — changing it on a
    // live instance has no effect. startRecognition() reads this ref
    // fresh each time it (re)creates the recognition object, so a
    // language change mid-session just needs a stop+start cycle (see
    // the effect below), not a whole new hook instance.
    const captionLangRef = useRef(captionLang);
    useEffect(() => { localSocketIdRef.current = localSocketId; }, [localSocketId]);
    useEffect(() => { localNameRef.current = localName; }, [localName]);
    useEffect(() => { captionLangRef.current = captionLang; }, [captionLang]);

    const removeCaptionAfterDelay = useCallback((socketId) => {
        clearTimeout(cleanupTimersRef.current[socketId]);
        cleanupTimersRef.current[socketId] = setTimeout(() => {
            setCaptionsBySpeaker((prev) => {
                if (!(socketId in prev)) return prev;
                const next = { ...prev };
                delete next[socketId];
                return next;
            });
        }, CAPTION_LINGER_MS);
    }, []);

    const applyCaptionLine = useCallback((socketId, name, text, isFinal) => {
        if (!socketId || !text || !text.trim()) return;
        setCaptionsBySpeaker((prev) => ({
            ...prev,
            [socketId]: { name, text: text.trim(), isFinal, updatedAt: Date.now() },
        }));
        removeCaptionAfterDelay(socketId);
    }, [removeCaptionAfterDelay]);

    // ── Remote captions arriving over the socket ──────────────────────
    useEffect(() => {
        if (!socket) return undefined;

        const onCaption = ({ socketId, name, text, isFinal }) => {
            if (socketId === localSocketIdRef.current) return; // we render our own locally, instantly
            applyCaptionLine(socketId, name, text, isFinal);
        };

        socket.on('caption-text', onCaption);
        return () => socket.off('caption-text', onCaption);
    }, [socket, applyCaptionLine]);

    // ── Local speech recognition ───────────────────────────────────────
    const startRecognition = useCallback(() => {
        if (!SpeechRecognitionImpl || !shouldRunRef.current) return;

        const recognition = new SpeechRecognitionImpl();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = captionLangRef.current;

        recognition.onresult = (event) => {
            let interimText = '';
            let finalText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) finalText += result[0].transcript;
                else interimText += result[0].transcript;
            }

            const text = (finalText || interimText).trim();
            if (!text) return;
            const isFinal = Boolean(finalText);

            applyCaptionLine(localSocketIdRef.current, localNameRef.current, text, isFinal);
            socket?.emit('caption-text', { roomId, text, isFinal });
        };

        recognition.onerror = (event) => {
            console.warn('[Captions] recognition error:', event.error);
            // Mic permission denied/revoked — stop trying rather than looping.
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                shouldRunRef.current = false;
                setCaptionsEnabled(false);
            }
        };

        // Browsers silently end recognition after silence/internal timeouts
        // even in continuous mode — restart automatically while enabled.
        recognition.onend = () => {
            if (!shouldRunRef.current) return;
            try {
                recognition.start();
            } catch {
                setTimeout(() => {
                    if (shouldRunRef.current) {
                        try { recognition.start(); } catch { /* give up silently this cycle */ }
                    }
                }, 300);
            }
        };

        recognitionRef.current = recognition;
        try {
            recognition.start();
        } catch (err) {
            console.warn('[Captions] Could not start recognition:', err);
        }
    }, [socket, roomId, applyCaptionLine]);

    const stopRecognition = useCallback(() => {
        shouldRunRef.current = false;
        const recognition = recognitionRef.current;
        if (recognition) {
            recognition.onend = null; // don't auto-restart on our own stop() call
            recognition.onresult = null;
            recognition.onerror = null;
            try { recognition.stop(); } catch { /* already stopped */ }
            recognitionRef.current = null;
        }
        setCaptionsBySpeaker((prev) => {
            const key = localSocketIdRef.current;
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    const toggleCaptions = useCallback(() => {
        if (!SpeechRecognitionImpl) return;
        setCaptionsEnabled((prev) => {
            const next = !prev;
            shouldRunRef.current = next;
            if (next) startRecognition();
            else stopRecognition();
            return next;
        });
    }, [startRecognition, stopRecognition]);

    // Changing language while captions are live: stop the current
    // recognition instance and start a fresh one with the new lang.
    // Guarded so this never fires on mount or while captions are off.
    const changeCaptionLang = useCallback((code) => {
        if (!CAPTION_LANGUAGES.some((l) => l.code === code)) return;
        setCaptionLangState(code);
        storeCaptionLang(code);
        captionLangRef.current = code;
        if (shouldRunRef.current) {
            const recognition = recognitionRef.current;
            if (recognition) {
                recognition.onend = null; // suppress the auto-restart in the OLD instance
                try { recognition.stop(); } catch { /* already stopped */ }
                recognitionRef.current = null;
            }
            startRecognition(); // picks up captionLangRef.current fresh
        }
    }, [startRecognition]);

    // Full teardown on unmount (leaving the room, etc.)
    useEffect(() => {
        return () => {
            shouldRunRef.current = false;
            const recognition = recognitionRef.current;
            if (recognition) {
                recognition.onend = null;
                try { recognition.stop(); } catch { /* noop */ }
            }
            Object.values(cleanupTimersRef.current).forEach(clearTimeout);
        };
    }, []);

    return {
        captionsSupported: CAPTIONS_SUPPORTED,
        captionsEnabled,
        captionsBySpeaker,
        toggleCaptions,
        captionLang,
        changeCaptionLang,
        captionLanguages: CAPTION_LANGUAGES,
    };
}