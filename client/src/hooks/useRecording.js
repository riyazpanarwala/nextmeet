import { useRef, useState, useCallback } from 'react';

/**
 * useRecording — records the local composite canvas (all video tiles)
 *
 * Strategy: We capture a <canvas> that we composite every ~33ms by drawing
 * each participant's <video> element into a grid. This gives a single
 * mixed-down recording that includes all participants visible on screen.
 *
 * Audio: We mix all MediaStream audio tracks via the Web Audio API into
 * one destination node, then add that audio track to the canvas stream.
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

  // ── Mix all active audio streams into one Web Audio destination ──
  const buildAudioMix = useCallback((streams) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const destination = ctx.createMediaStreamDestination();

    streams.forEach((stream) => {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;
      try {
        const source = ctx.createMediaStreamSource(stream);
        source.connect(destination);
      } catch (e) {
        console.warn('[Recording] Could not connect audio source:', e);
      }
    });

    audioCtxRef.current = ctx;
    destinationRef.current = destination;
    return destination.stream;
  }, []);

  const startRecording = useCallback(async (participantStreams) => {
    if (isRecording) return;

    // participantStreams: [{ name, stream, isLocal }]
    const activeStreams = participantStreams.filter((p) => p.stream);

    if (activeStreams.length === 0) {
      console.warn('[Recording] No streams to record');
      return;
    }

    // ── Create canvas ──
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;
    const ctx2d = canvas.getContext('2d');

    // ── Composite loop — draw all video tiles at ~30fps ──
    const draw = () => {
      const count = activeStreams.length;
      const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
      const rows = Math.ceil(count / cols);
      const tileW = canvas.width / cols;
      const tileH = canvas.height / rows;

      ctx2d.fillStyle = '#0a0d14';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);

      // Find all <video> elements in the DOM and match by stream
      const videoEls = Array.from(document.querySelectorAll('video'));

      activeStreams.forEach((participant, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * tileW;
        const y = row * tileH;

        const videoEl = videoEls.find(
          (v) => v.srcObject && v.srcObject.id === participant.stream?.id
        );

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

    // ── Mix audio from all streams ──
    const audioMixStream = buildAudioMix(activeStreams.map((p) => p.stream));

    // ── Combine canvas video + mixed audio ──
    const canvasStream = canvas.captureStream(30);
    const audioTrack = audioMixStream.getAudioTracks()[0];
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
  }, [isRecording, buildAudioMix]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    cancelAnimationFrame(rafRef.current);
    clearInterval(timerRef.current);

    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    destinationRef.current = null;
    canvasRef.current = null;

    setIsRecording(false);
  }, [isRecording]);

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
