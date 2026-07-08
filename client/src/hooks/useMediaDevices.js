import { useState, useRef, useCallback, useEffect } from 'react';

export function useMediaDevices() {
  const localStreamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [devices, setDevices] = useState({ audioIn: [], audioOut: [], videoIn: [] });
  const [selectedDevices, setSelectedDevices] = useState({
    audioIn: '',
    audioOut: '',
    videoIn: '',
  });
  // Whether the local stream actually has a working track of each kind.
  // These are the source of truth for disabling controls; isMuted/isVideoOff
  // remain purely "user wants this on/off" state and can be true even when
  // there's no track at all (e.g. no camera present).
  const [hasAudioTrack, setHasAudioTrack] = useState(false);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const screenStreamRef = useRef(null);

  const loadDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audioIn: all.filter((d) => d.kind === 'audioinput'),
        audioOut: all.filter((d) => d.kind === 'audiooutput'),
        videoIn: all.filter((d) => d.kind === 'videoinput'),
      });
    } catch (err) {
      console.error('enumerateDevices error:', err);
    }
  }, []);

  const startLocalStream = useCallback(
    async (audioDeviceId, videoDeviceId, initialState = { isMuted, isVideoOff }) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera and microphone require HTTPS or localhost in this browser.');
      }

      const videoConstraint = videoDeviceId
        ? {
            deviceId: { exact: videoDeviceId },
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 24, max: 24 },
          }
        : {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 24, max: 24 },
          };
      const audioConstraint = audioDeviceId
        ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };

      let stream;
      let gotAudio = true;
      let gotVideo = true;

      // 1) Try both audio + video together (the common case)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint,
        });
      } catch (bothErr) {
        console.warn('[Media] audio+video failed:', bothErr.name, '— trying fallbacks');

        // 2) Try audio only (covers: no camera, camera denied, camera in use)
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraint,
            video: false,
          });
          gotVideo = false;
          console.warn('[Media] Joining audio-only — no usable camera');
        } catch (audioOnlyErr) {
          // 3) Try video only (covers: no mic, mic denied, mic in use)
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: videoConstraint,
            });
            gotAudio = false;
            console.warn('[Media] Joining video-only — no usable microphone');
          } catch (videoOnlyErr) {
            // 4) Neither works at all — nothing to join with.
            // Re-throw the original combined error; it's usually the most
            // informative (e.g. NotFoundError when the machine truly has
            // neither device attached).
            throw bothErr;
          }
        }
      }

      const nextMuted = Boolean(initialState.isMuted) || !gotAudio;
      const nextVideoOff = Boolean(initialState.isVideoOff) || !gotVideo;

      stream.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
      stream.getVideoTracks().forEach((track) => { track.enabled = !nextVideoOff; });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsMuted(nextMuted);
      setIsVideoOff(nextVideoOff);
      setHasAudioTrack(gotAudio);
      setHasVideoTrack(gotVideo);
      const activeAudioDeviceId = stream.getAudioTracks()[0]?.getSettings?.().deviceId || '';
      const activeVideoDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || '';
      setSelectedDevices((prev) => ({
        ...prev,
        audioIn: activeAudioDeviceId || audioDeviceId || prev.audioIn,
        videoIn: activeVideoDeviceId || videoDeviceId || prev.videoIn,
      }));
      await loadDevices();
      return stream;
    },
    [loadDevices, isMuted, isVideoOff]
  );

  // NOTE: Room.jsx manages track.enabled directly via refs for immediacy.
  // These setters exist only to trigger React re-renders for the UI state.
  // They're also guarded so toggling is a no-op when there's no real track
  // to toggle (e.g. clicking "unmute" when no microphone was ever captured).
  const toggleMute = useCallback(() => {
    setHasAudioTrack((has) => {
      if (has) setIsMuted((prev) => !prev);
      return has;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    setHasVideoTrack((has) => {
      if (has) setIsVideoOff((prev) => !prev);
      return has;
    });
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser.');
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 15, max: 15 },
        },
        audio: true,
      });
      screenStreamRef.current = screenStream;

      // When screen share ends via the browser's built-in stop button
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      setIsScreenSharing(true);
      return screenStream;
    } catch (err) {
      console.error('getDisplayMedia error:', err);
      throw err;
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    const screen = screenStreamRef.current;
    if (screen) {
      screen.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
  }, []);

  const switchAudioDevice = useCallback(
    async (deviceId) => {
      const newStream = await startLocalStream(deviceId, selectedDevices.videoIn);
      return newStream;
    },
    [startLocalStream, selectedDevices.videoIn]
  );

  const switchVideoDevice = useCallback(
    async (deviceId) => {
      const newStream = await startLocalStream(selectedDevices.audioIn, deviceId);
      return newStream;
    },
    [startLocalStream, selectedDevices.audioIn]
  );

  const setSpeakerDevice = useCallback((deviceId) => {
    setSelectedDevices((prev) => ({ ...prev, audioOut: deviceId }));
    // Apply to all audio elements
    document.querySelectorAll('audio, video').forEach((el) => {
      if (el.setSinkId) el.setSinkId(deviceId).catch(console.error);
    });
  }, []);

  const stopAll = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    setLocalStream(null);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, [loadDevices]);

  return {
    localStream,
    localStreamRef,
    screenStreamRef,
    isMuted,
    isVideoOff,
    isScreenSharing,
    hasAudioTrack,
    hasVideoTrack,
    devices,
    selectedDevices,
    startLocalStream,
    toggleMute,
    toggleVideo,
    startScreenShare,
    stopScreenShare,
    switchAudioDevice,
    switchVideoDevice,
    setSpeakerDevice,
    stopAll,
  };
}
