import { useEffect, useRef, useCallback } from 'react';

export function useAudioLevel(stream, onSpeaking, threshold = 15) {
  const animFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const contextRef = useRef(null);
  const isSpeakingRef = useRef(false);

  const stop = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    sourceRef.current?.disconnect();
    contextRef.current?.close();
    analyserRef.current = null;
    sourceRef.current = null;
    contextRef.current = null;
    isSpeakingRef.current = false;
  }, []);

  useEffect(() => {
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      contextRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;

      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const speaking = avg > threshold;

        if (speaking !== isSpeakingRef.current) {
          isSpeakingRef.current = speaking;
          onSpeaking?.(speaking);
        }

        animFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (err) {
      console.warn('[AudioLevel] Error setting up analyser:', err);
    }

    return stop;
  }, [stream, threshold, onSpeaking, stop]);

  return { stop };
}
