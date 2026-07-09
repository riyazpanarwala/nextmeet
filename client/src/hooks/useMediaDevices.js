import { useState, useRef, useCallback, useEffect } from 'react';

const CAMERA_VIDEO_CONSTRAINT = {
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: 30, max: 30 },
  resizeMode: 'crop-and-scale',
};

const SCREEN_VIDEO_CONSTRAINT = {
  cursor: 'always',
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

const AUDIO_CONSTRAINT = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  latency: { ideal: 0.02 },
};

function applyContentHint(track, hint) {
  if (!track || !('contentHint' in track)) return;

  try {
    track.contentHint = hint;
  } catch (err) {
    console.warn('[Media] Could not apply content hint:', err);
  }
}

function getVideoConstraint(deviceId) {
  return deviceId
    ? { ...CAMERA_VIDEO_CONSTRAINT, deviceId: { exact: deviceId } }
    : CAMERA_VIDEO_CONSTRAINT;
}

function getAudioConstraint(deviceId) {
  return deviceId
    ? { ...AUDIO_CONSTRAINT, deviceId: { exact: deviceId } }
    : AUDIO_CONSTRAINT;
}

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

  // Refs so toggleMute/toggleVideo can read the latest hasAudioTrack/
  // hasVideoTrack without needing them in their own dependency arrays
  // (and without the setState-updater-as-getter trick).
  const isMutedRef = useRef(isMuted);
  const isVideoOffRef = useRef(isVideoOff);
  const hasAudioTrackRef = useRef(hasAudioTrack);
  const hasVideoTrackRef = useRef(hasVideoTrack);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isVideoOffRef.current = isVideoOff; }, [isVideoOff]);
  useEffect(() => { hasAudioTrackRef.current = hasAudioTrack; }, [hasAudioTrack]);
  useEffect(() => { hasVideoTrackRef.current = hasVideoTrack; }, [hasVideoTrack]);

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

      const videoConstraint = getVideoConstraint(videoDeviceId);
      const audioConstraint = getAudioConstraint(audioDeviceId);

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
      stream.getVideoTracks().forEach((track) => {
        applyContentHint(track, 'motion');
        track.enabled = !nextVideoOff;
      });

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
    if (hasAudioTrackRef.current) setIsMuted((prev) => !prev);
  }, []);

  const toggleVideo = useCallback(() => {
    if (hasVideoTrackRef.current) setIsVideoOff((prev) => !prev);
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser.');
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: SCREEN_VIDEO_CONSTRAINT,
        audio: true,
      });
      screenStreamRef.current = screenStream;
      screenStream.getVideoTracks().forEach((track) => applyContentHint(track, 'detail'));

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

  // Switches the microphone only. Captures a fresh audio-only stream,
  // keeps the existing video track(s) untouched, and stops only the old
  // audio track. Mirrors switchVideoDevice's "swap just one kind of
  // track" approach so that changing your mic never flickers/restarts
  // the camera or forces a video-track replaceTrack() on active peer
  // connections.
  const switchAudioDevice = useCallback(
    async (deviceId) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone switching requires HTTPS or localhost in this browser.');
      }

      const currentStream = localStreamRef.current;
      const currentVideoTracks = currentStream?.getVideoTracks() || [];
      const audioConstraint = getAudioConstraint(deviceId);

      const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: false,
      });

      const audioTracks = audioOnlyStream.getAudioTracks();
      audioTracks.forEach((track) => { track.enabled = !isMutedRef.current; });

      // Stop the old mic track(s) only — camera keeps rolling untouched.
      currentStream?.getAudioTracks().forEach((track) => track.stop());

      const nextStream = new MediaStream([...audioTracks, ...currentVideoTracks]);
      const activeAudioDeviceId = audioTracks[0]?.getSettings?.().deviceId || deviceId || '';

      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      setHasAudioTrack(audioTracks.length > 0);
      setSelectedDevices((prev) => ({
        ...prev,
        audioIn: activeAudioDeviceId || prev.audioIn,
      }));
      await loadDevices();
      return nextStream;
    },
    [loadDevices]
  );

  const switchVideoDevice = useCallback(
    async (deviceId) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera switching requires HTTPS or localhost in this browser.');
      }

      const currentStream = localStreamRef.current;
      const currentAudioTracks = currentStream?.getAudioTracks() || [];
      const previousVideoDeviceId =
        selectedDevices.videoIn ||
        currentStream?.getVideoTracks()[0]?.getSettings?.().deviceId ||
        '';

      const captureVideoDevice = async (targetDeviceId) => {
        const videoConstraint = getVideoConstraint(targetDeviceId);

        const videoOnlyStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraint,
        });
        const videoTracks = videoOnlyStream.getVideoTracks();
        videoTracks.forEach((track) => {
          applyContentHint(track, 'motion');
          track.enabled = !isVideoOffRef.current;
        });

        const nextStream = new MediaStream([...currentAudioTracks, ...videoTracks]);
        const activeVideoDeviceId = videoTracks[0]?.getSettings?.().deviceId || targetDeviceId || '';

        localStreamRef.current = nextStream;
        setLocalStream(nextStream);
        setHasVideoTrack(videoTracks.length > 0);
        setSelectedDevices((prev) => ({
          ...prev,
          videoIn: activeVideoDeviceId || prev.videoIn,
        }));
        await loadDevices();
        return nextStream;
      };

      currentStream?.getVideoTracks().forEach((track) => track.stop());

      try {
        return await captureVideoDevice(deviceId);
      } catch (err) {
        console.error('[Media] video device switch failed:', err);
        if (previousVideoDeviceId && previousVideoDeviceId !== deviceId) {
          try {
            console.warn('[Media] restoring previous camera');
            const restoredStream = await captureVideoDevice(previousVideoDeviceId);
            const switchErr = new Error('Could not switch to that camera. Restored the previous camera.');
            switchErr.restoredStream = restoredStream;
            throw switchErr;
          } catch (restoreErr) {
            if (restoreErr?.restoredStream) throw restoreErr;
            console.error('[Media] previous camera restore failed:', restoreErr);
          }
        }
        throw err;
      }
    },
    [loadDevices, selectedDevices.videoIn]
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
