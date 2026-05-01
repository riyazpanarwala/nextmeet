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
  const screenStreamRef = useRef(null);

  const loadDevices = useCallback(async () => {
    try {
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
    async (audioDeviceId, videoDeviceId) => {
      try {
        const constraints = {
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
          video: videoDeviceId
            ? { deviceId: { exact: videoDeviceId }, width: 1280, height: 720 }
            : { width: 1280, height: 720 },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        setLocalStream(stream);
        await loadDevices();
        return stream;
      } catch (err) {
        console.error('getUserMedia error:', err);
        throw err;
      }
    },
    [loadDevices]
  );

  // NOTE: Room.jsx manages track.enabled directly via refs for immediacy.
  // These setters exist only to trigger React re-renders for the UI state.
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const toggleVideo = useCallback(() => {
    setIsVideoOff((prev) => !prev);
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
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
      setSelectedDevices((prev) => ({ ...prev, audioIn: deviceId }));
      const newStream = await startLocalStream(deviceId, selectedDevices.videoIn);
      return newStream;
    },
    [startLocalStream, selectedDevices.videoIn]
  );

  const switchVideoDevice = useCallback(
    async (deviceId) => {
      setSelectedDevices((prev) => ({ ...prev, videoIn: deviceId }));
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
