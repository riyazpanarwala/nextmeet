import { useRef, useState, useCallback } from 'react';

/**
 * useRecording — records the local composite canvas (all video tiles)
 *
 * Strategy: We capture a <canvas> that we composite every ~33ms by drawing
 * each participant's <video> element into a grid. This gives a single
 * mixed-down recording that includes all participants visible on screen.
 *
 * LIVE SOURCE: startRecording() takes a GETTER FUNCTION, not a fixed array.
 * The compositor calls it every frame and reconciles against whatever it
 * returns. This matters because a fixed snapshot goes stale the moment
 * anything changes mid-recording:
 *   - Local device switches (mic/camera) replace localStream with a brand
 *     new MediaStream object — a frozen snapshot keeps pointing at the old
 *     one, whose tracks just got stopped, so that tile freezes/blacks out.
 *   - A participant joining, leaving, or starting/stopping a screen share
 *     after recording started wouldn't show up in a fixed array at all.
 * Reconciling by a stable per-participant `key` (socketId, or
 * `${socketId}-screen` for shares) — rather than by stream id — lets the
 * same tile "slot" survive its underlying stream object being swapped out.
 *
 * We also own dedicated OFFSCREEN <video> elements per participant, rather
 * than searching the visible DOM for a matching tile. This avoids matching
 * the wrong element when a participant is duplicated into the floating PiP
 * window, and avoids losing the match entirely when a tile remounts due to
 * pin/spotlight layout changes.
 *
 * Audio: each participant's audio track(s) are connected into a shared Web
 * Audio mix destination via a MediaStreamAudioSourceNode per key, rebuilt
 * whenever that key's stream object changes, and disconnected when the
 * key drops out of the live participant list.
 */
export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [lastBlob, setLastBlob] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const destinationRef = useRef(null);
  const startTimeRef = useRef(null);
  // Always-current "get the live participant list" function, supplied by
  // the caller and re-read every frame — see startRecording().
  const getParticipantsRef = useRef(() => []);
  // key -> offscreen <video> element dedicated to recording.
  const recordingVideoElsRef = useRef({});
  // key -> { streamId, source } for the Web Audio graph.
  const audioSourcesRef = useRef({});

  // Creates/repoints/removes hidden <video> elements so they always match
  // the current participant list, keyed by a stable identity (not stream
  // id, since a participant's stream object can change under the same
  // key — e.g. a local device switch).
  const syncOffscreenVideoEls = useCallback((participants) => {
    const map = recordingVideoElsRef.current;
    const seenKeys = new Set();

    participants.forEach((participant) => {
      const { key, stream } = participant;
      if (!key) return;
      seenKeys.add(key);

      if (!stream) {
        // No stream right now — drop any stale element so the compositor
        // falls back to the avatar tile instead of a frozen last frame.
        const existing = map[key];
        if (existing) {
          existing.pause();
          existing.srcObject = null;
          existing.remove();
          delete map[key];
        }
        return;
      }

      const existing = map[key];
      if (existing) {
        if (existing.srcObject !== stream) {
          // Same participant, new stream object (e.g. local device switch)
          // — repoint the existing element instead of leaving it frozen
          // on the old, now-stopped tracks.
          existing.srcObject = stream;
          existing.play().catch(() => { });
        }
        return;
      }

      const videoEl = document.createElement('video');
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      videoEl.style.position = 'fixed';
      videoEl.style.left = '-9999px';
      videoEl.style.top = '-9999px';
      videoEl.style.width = '2px';
      videoEl.style.height = '2px';
      videoEl.style.opacity = '0';
      videoEl.style.pointerEvents = 'none';
      videoEl.srcObject = stream;
      document.body.appendChild(videoEl);
      videoEl.play().catch((e) => {
        console.warn('[Recording] Offscreen video play() failed:', e);
      });
      map[key] = videoEl;
    });

    // Remove elements for keys no longer present (left the room, stopped
    // screen sharing, etc.)
    Object.keys(map).forEach((key) => {
      if (!seenKeys.has(key)) {
        map[key].pause();
        map[key].srcObject = null;
        map[key].remove();
        delete map[key];
      }
    });
  }, []);

  const teardownOffscreenVideoEls = useCallback(() => {
    Object.values(recordingVideoElsRef.current).forEach((videoEl) => {
      try {
        videoEl.pause();
        videoEl.srcObject = null;
        videoEl.remove();
      } catch (e) {
        // Element may already be detached — safe to ignore.
      }
    });
    recordingVideoElsRef.current = {};
  }, []);

  // Same reconciliation idea as syncOffscreenVideoEls, but for the Web
  // Audio graph: connects a MediaStreamAudioSourceNode per key, rebuilds
  // it if that key's stream object changes, and disconnects it if the key
  // drops out or loses its audio track(s).
  const syncAudioSources = useCallback((participants) => {
    const ctx = audioCtxRef.current;
    const destination = destinationRef.current;
    if (!ctx || !destination) return;

    const map = audioSourcesRef.current;
    const seenKeys = new Set();

    participants.forEach((participant) => {
      const { key, stream } = participant;
      if (!key) return;
      seenKeys.add(key);

      const audioTracks = stream ? stream.getAudioTracks() : [];
      const existing = map[key];

      if (audioTracks.length === 0) {
        if (existing) {
          try { existing.source.disconnect(); } catch (e) { /* already disconnected */ }
          delete map[key];
        }
        return;
      }

      if (existing && existing.streamId === stream.id) {
        return; // already wired up correctly
      }

      if (existing) {
        try { existing.source.disconnect(); } catch (e) { /* already disconnected */ }
      }
      try {
        const source = ctx.createMediaStreamSource(stream);
        source.connect(destination);
        map[key] = { streamId: stream.id, source };
      } catch (e) {
        console.warn('[Recording] Could not connect audio source:', e);
      }
    });

    Object.keys(map).forEach((key) => {
      if (!seenKeys.has(key)) {
        try { map[key].source.disconnect(); } catch (e) { /* already disconnected */ }
        delete map[key];
      }
    });
  }, []);

  // `participantsSource` is expected to be a function returning the
  // current array of { key, name, stream, isLocal }. A plain array is
  // still accepted for backward compatibility, but won't update live.
  const startRecording = useCallback(async (participantsSource) => {
    if (isRecording) return;

    const getParticipants = typeof participantsSource === 'function'
      ? participantsSource
      : () => participantsSource;

    const initialParticipants = (getParticipants() || []).filter((p) => p.stream);
    if (initialParticipants.length === 0) {
      console.warn('[Recording] No streams to record');
      return;
    }

    getParticipantsRef.current = getParticipants;

    // ── Audio context + shared mix destination ──
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const destination = ctx.createMediaStreamDestination();
    audioCtxRef.current = ctx;
    destinationRef.current = destination;
    audioSourcesRef.current = {};

    syncOffscreenVideoEls(initialParticipants);
    syncAudioSources(initialParticipants);

    // ── Create canvas ──
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;
    const ctx2d = canvas.getContext('2d');

    // ── Composite loop — draw all video tiles at ~30fps ──
    const draw = () => {
      const participants = (getParticipantsRef.current() || []).filter((p) => p.key);

      // Reconcile against whoever is actually here right now — joins,
      // leaves, screen-share starts/stops, and local device switches all
      // show up on the next frame instead of freezing or dropping out.
      syncOffscreenVideoEls(participants);
      syncAudioSources(participants);

      const count = participants.length;
      const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
      const rows = Math.ceil(count / cols) || 1;
      const tileW = canvas.width / cols;
      const tileH = canvas.height / rows;

      ctx2d.fillStyle = '#0a0d14';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);

      participants.forEach((participant, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * tileW;
        const y = row * tileH;

        const videoEl = recordingVideoElsRef.current[participant.key];

        if (videoEl && videoEl.readyState >= 2) {
          try {
            ctx2d.drawImage(videoEl, x, y, tileW, tileH);
          } catch (e) {
            // frame not ready
          }
        } else {
          // Avatar fallback
          ctx2d.fillStyle = '#1a2235';
          ctx2d.fillRect(x, y, tileW, tileH);
          ctx2d.fillStyle = '#3b82f6';
          const avatarSize = Math.min(tileW, tileH) * 0.25;
          ctx2d.beginPath();
          ctx2d.arc(x + tileW / 2, y + tileH / 2, avatarSize, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.fillStyle = '#fff';
          ctx2d.font = `bold ${avatarSize * 0.9}px sans-serif`;
          ctx2d.textAlign = 'center';
          ctx2d.textBaseline = 'middle';
          const initials = (participant.name || '?').slice(0, 1).toUpperCase();
          ctx2d.fillText(initials, x + tileW / 2, y + tileH / 2);
        }

        // Name label
        ctx2d.fillStyle = 'rgba(0,0,0,0.55)';
        ctx2d.fillRect(x + 8, y + tileH - 32, tileW - 16, 24);
        ctx2d.fillStyle = '#fff';
        ctx2d.font = '13px DM Sans, sans-serif';
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillText(
          participant.name + (participant.isLocal ? ' (You)' : ''),
          x + 16,
          y + tileH - 20
        );

        // REC indicator on first tile
        if (i === 0) {
          ctx2d.fillStyle = '#ef4444';
          ctx2d.beginPath();
          ctx2d.arc(canvas.width - 24, 20, 7, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.fillStyle = '#fff';
          ctx2d.font = 'bold 11px sans-serif';
          ctx2d.textAlign = 'right';
          ctx2d.fillText('REC', canvas.width - 34, 20);
        }
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();

    // ── Combine canvas video + mixed audio ──
    const canvasStream = canvas.captureStream(30);
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    // ── Start MediaRecorder ──
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : {};

    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, options);
    } catch (e) {
      recorder = new MediaRecorder(canvasStream);
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const mimeUsed = recorder.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: mimeUsed });
      setLastBlob(blob);
      chunksRef.current = [];
    };

    recorder.start(1000); // collect data every second
    mediaRecorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setIsRecording(true);
    setRecordingDuration(0);

    // Duration timer
    timerRef.current = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [isRecording, syncOffscreenVideoEls, syncAudioSources]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    cancelAnimationFrame(rafRef.current);
    clearInterval(timerRef.current);

    Object.values(audioSourcesRef.current).forEach(({ source }) => {
      try { source.disconnect(); } catch (e) { /* already disconnected */ }
    });
    audioSourcesRef.current = {};

    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    destinationRef.current = null;
    canvasRef.current = null;
    teardownOffscreenVideoEls();
    getParticipantsRef.current = () => [];

    setIsRecording(false);
  }, [isRecording, teardownOffscreenVideoEls]);

  const downloadRecording = useCallback((fileName) => {
    if (!lastBlob) return;
    const ext = lastBlob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(lastBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `nexmeet-recording-${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [lastBlob]);

  const clearRecording = useCallback(() => setLastBlob(null), []);

  return {
    isRecording,
    recordingDuration,
    lastBlob,
    startRecording,
    stopRecording,
    downloadRecording,
    clearRecording,
  };
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}