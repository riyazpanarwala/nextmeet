import { useEffect, useState, useCallback, useRef } from 'react';
import { usePeerConnections } from '../hooks/usePeerConnections';
import { useRecording } from '../hooks/useRecording';
import { useAnnotations } from '../hooks/useAnnotations';
import { VideoTile } from './VideoTile';
import { Controls } from './Controls';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RecordingPanel } from './RecordingPanel';
import { AnnotationToolbar } from './AnnotationToolbar';

const MAX_SCREEN_SHARES = 2;

export function Room({ socket, localInfo, mediaState, onLeave }) {
  const {
    localStream, localStreamRef, screenStreamRef,
    isMuted, isVideoOff, isScreenSharing,
    hasAudioTrack, hasVideoTrack,
    devices, selectedDevices,
    toggleMute, toggleVideo,
    startScreenShare, stopScreenShare,
    switchAudioDevice, switchVideoDevice, setSpeakerDevice,
    stopAll,
  } = mediaState;

  const [remoteParticipants, setRemoteParticipants] = useState({});
  const [remoteScreenShares, setRemoteScreenShares] = useState({}); // socketId -> MediaStream
  const [activeSharerIds, setActiveSharerIds] = useState(new Set()); // socketIds currently sharing (remote + local)
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showRecording, setShowRecording] = useState(false);
  const [pinnedScreenId, setPinnedScreenId] = useState(null); // user-selected "main" screen share
  const [isHost, setIsHost] = useState(false);
  const [localSocketId, setLocalSocketId] = useState('');
  const [roomFullError, setRoomFullError] = useState(false);
  const [localHandRaised, setLocalHandRaised] = useState(false);

  // ── Annotation (screen-share drawing, sharer-only) ───────────────
  const [annotationTool, setAnnotationTool] = useState(null); // 'pen' | 'arrow' | 'rect' | 'circle' | null
  const [annotationColor, setAnnotationColor] = useState('#ef4444');
  const [annotationAccessByScreen, setAnnotationAccessByScreen] = useState({});
  const [annotationRequests, setAnnotationRequests] = useState({});
  const [grantedAnnotators, setGrantedAnnotators] = useState({});
  const [activeAnnotationScreenOwnerId, setActiveAnnotationScreenOwnerId] = useState('');
  const { shapesByScreen, addShape, undoLastShape, clearShapes, removeScreen } = useAnnotations({
    socket,
    roomId: localInfo.roomId,
  });

  // Stable refs so socket handlers don't re-register on every render
  const isMutedRef = useRef(isMuted);
  const isVideoOffRef = useRef(isVideoOff);
  const isHostRef = useRef(isHost);
  const localSocketIdRef = useRef(localSocketId);
  const showChatRef = useRef(showChat);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isVideoOffRef.current = isVideoOff; }, [isVideoOff]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { localSocketIdRef.current = localSocketId; }, [localSocketId]);
  useEffect(() => { showChatRef.current = showChat; }, [showChat]);

  // Screen-share refs (avoid stale closures in socket handlers)
  const remoteParticipantsRef = useRef(remoteParticipants);
  useEffect(() => { remoteParticipantsRef.current = remoteParticipants; }, [remoteParticipants]);
  const isScreenSharingRef = useRef(false);

  // ── Recording hook ──────────────────────────────────────────────
  const {
    isRecording, recordingDuration, lastBlob,
    startRecording, stopRecording, downloadRecording, clearRecording,
  } = useRecording();

  // ── Remote stream / peer left (camera) ───────────────────────────
  const handleRemoteStream = useCallback((socketId, stream) => {
    setRemoteParticipants((prev) => ({
      ...prev,
      [socketId]: { ...(prev[socketId] || {}), stream },
    }));
  }, []);

  const handlePeerLeft = useCallback((socketId) => {
    setRemoteParticipants((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  // ── Remote screen stream / screen peer left ──────────────────────
  const handleRemoteScreenStream = useCallback((socketId, stream) => {
    setRemoteScreenShares((prev) => ({ ...prev, [socketId]: stream }));
  }, []);

  const handleScreenPeerLeft = useCallback((socketId) => {
    setRemoteScreenShares((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const {
    makeOffer, handleOffer, handleAnswer,
    handleIceCandidate, closePeer, closeAll, replaceTrack,
    makeScreenOffer, handleScreenOffer, handleScreenAnswer,
    handleScreenIceCandidate, closeOutgoingScreenPeer, closeIncomingScreenPeer,
    closeScreenPeer, closeAllScreenPeers,
  } = usePeerConnections({
    socket,
    localStreamRef,
    onRemoteStream: handleRemoteStream,
    onPeerLeft: handlePeerLeft,
    onRemoteScreenStream: handleRemoteScreenStream,
    onScreenPeerLeft: handleScreenPeerLeft,
  });

  // Stable refs for WebRTC fns (camera)
  const makeOfferRef = useRef(makeOffer);
  const handleOfferRef = useRef(handleOffer);
  const handleAnswerRef = useRef(handleAnswer);
  const handleIceCandidateRef = useRef(handleIceCandidate);
  const closePeerRef = useRef(closePeer);
  const handlePeerLeftRef = useRef(handlePeerLeft);
  useEffect(() => { makeOfferRef.current = makeOffer; }, [makeOffer]);
  useEffect(() => { handleOfferRef.current = handleOffer; }, [handleOffer]);
  useEffect(() => { handleAnswerRef.current = handleAnswer; }, [handleAnswer]);
  useEffect(() => { handleIceCandidateRef.current = handleIceCandidate; }, [handleIceCandidate]);
  useEffect(() => { closePeerRef.current = closePeer; }, [closePeer]);
  useEffect(() => { handlePeerLeftRef.current = handlePeerLeft; }, [handlePeerLeft]);

  // Stable refs for WebRTC fns (screen)
  const makeScreenOfferRef = useRef(makeScreenOffer);
  const handleScreenOfferRef = useRef(handleScreenOffer);
  const handleScreenAnswerRef = useRef(handleScreenAnswer);
  const handleScreenIceCandidateRef = useRef(handleScreenIceCandidate);
  const closeOutgoingScreenPeerRef = useRef(closeOutgoingScreenPeer);
  const closeIncomingScreenPeerRef = useRef(closeIncomingScreenPeer);
  const closeScreenPeerRef = useRef(closeScreenPeer);
  useEffect(() => { makeScreenOfferRef.current = makeScreenOffer; }, [makeScreenOffer]);
  useEffect(() => { handleScreenOfferRef.current = handleScreenOffer; }, [handleScreenOffer]);
  useEffect(() => { handleScreenAnswerRef.current = handleScreenAnswer; }, [handleScreenAnswer]);
  useEffect(() => { handleScreenIceCandidateRef.current = handleScreenIceCandidate; }, [handleScreenIceCandidate]);
  useEffect(() => { closeOutgoingScreenPeerRef.current = closeOutgoingScreenPeer; }, [closeOutgoingScreenPeer]);
  useEffect(() => { closeIncomingScreenPeerRef.current = closeIncomingScreenPeer; }, [closeIncomingScreenPeer]);
  useEffect(() => { closeScreenPeerRef.current = closeScreenPeer; }, [closeScreenPeer]);

  // Stable ref for annotation cleanup (avoid stale closures in socket handlers)
  const removeScreenRef = useRef(removeScreen);
  useEffect(() => { removeScreenRef.current = removeScreen; }, [removeScreen]);

  // ── Register socket listeners ONCE, then emit join-room ─────────
  useEffect(() => {
    if (!socket) return;

    const onRoomJoined = ({ socketId, isHost: amHost, participants, screenSharingSocketIds }) => {
      console.log('[Room] room-joined', socketId, 'host:', amHost, 'peers:', participants.length);
      setLocalSocketId(socketId);
      localSocketIdRef.current = socketId;
      setIsHost(amHost);
      isHostRef.current = amHost;

      if (participants.length > 0) {
        setRemoteParticipants((prev) => {
          const next = { ...prev };
          participants.forEach((p) => {
            next[p.socketId] = {
              ...(next[p.socketId] || {}),
              name: p.name,
              isHost: p.isHost,
              isMuted: p.isMuted,
              isVideoOff: p.isVideoOff,
            };
          });
          return next;
        });
        participants.forEach((p) => {
          console.log('[Room] Sending offer to existing peer:', p.socketId);
          makeOfferRef.current(p.socketId);
        });
      }

      // Track who's already sharing when we join — their screen offer
      // will arrive shortly since the sharer re-offers on 'user-joined'.
      if (screenSharingSocketIds?.length) {
        setActiveSharerIds(new Set(screenSharingSocketIds));
      }
    };

    const onUserJoined = ({
      socketId,
      name,
      isHost: theirHost,
      isMuted: theirMuted,
      isVideoOff: theirVideoOff,
      handRaised: theirHandRaised,
    }) => {
      console.log('[Room] user-joined:', socketId, name);
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: {
          ...(prev[socketId] || {}),
          name,
          isHost: theirHost,
          isMuted: Boolean(theirMuted),
          isVideoOff: Boolean(theirVideoOff),
          handRaised: Boolean(theirHandRaised),
        },
      }));

      // If I'm currently sharing my screen, extend that share to the newcomer
      if (isScreenSharingRef.current && screenStreamRef.current) {
        console.log('[Room] Extending active screen share to newcomer:', socketId);
        makeScreenOfferRef.current(socketId, screenStreamRef.current);
      }
    };

    const onRoomFull = ({ max }) => {
      console.warn(`[Room] Room is full (max ${max})`);
      setRoomFullError(true);
    };

    const onOffer = async ({ from, offer, kind }) => {
      console.log('[Room] received offer from:', from, 'kind:', kind || 'camera');
      if (kind === 'screen') {
        await handleScreenOfferRef.current(from, offer);
      } else {
        await handleOfferRef.current(from, offer);
      }
    };

    const onAnswer = async ({ from, answer, kind }) => {
      console.log('[Room] received answer from:', from, 'kind:', kind || 'camera');
      if (kind === 'screen') {
        await handleScreenAnswerRef.current(from, answer);
      } else {
        await handleAnswerRef.current(from, answer);
      }
    };

    const onIceCandidate = async ({ from, candidate, kind }) => {
      if (kind === 'screen') {
        await handleScreenIceCandidateRef.current(from, candidate);
      } else {
        await handleIceCandidateRef.current(from, candidate);
      }
    };

    const onUserLeft = ({ socketId }) => {
      console.log('[Room] user-left:', socketId);
      closePeerRef.current(socketId);
      closeScreenPeerRef.current(socketId);
      handlePeerLeftRef.current(socketId);
      setRemoteScreenShares((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
      setActiveSharerIds((prev) => {
        const next = new Set(prev);
        next.delete(socketId);
        return next;
      });
      setAnnotationAccessByScreen((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
      setAnnotationRequests((prev) => {
        const next = { ...prev };
        delete next[socketId];
        Object.keys(next).forEach((screenOwnerId) => {
          if (next[screenOwnerId]?.[socketId]) {
            next[screenOwnerId] = { ...next[screenOwnerId] };
            delete next[screenOwnerId][socketId];
          }
        });
        return next;
      });
      setGrantedAnnotators((prev) => {
        const next = { ...prev };
        delete next[socketId];
        Object.keys(next).forEach((screenOwnerId) => {
          if (next[screenOwnerId]?.[socketId]) {
            next[screenOwnerId] = { ...next[screenOwnerId] };
            delete next[screenOwnerId][socketId];
          }
        });
        return next;
      });
      setActiveAnnotationScreenOwnerId((prev) => (prev === socketId ? '' : prev));
      removeScreenRef.current(socketId);
    };

    const onPeerMediaState = ({ socketId, isMuted: m, isVideoOff: v }) => {
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: { ...(prev[socketId] || {}), isMuted: m, isVideoOff: v },
      }));
    };

    const onPeerHandState = ({ socketId, raised }) => {
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: { ...(prev[socketId] || {}), handRaised: Boolean(raised) },
      }));
    };

    const onPeerScreenShare = ({ socketId, sharing }) => {
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: { ...(prev[socketId] || {}), isScreenSharing: sharing },
      }));

      setActiveSharerIds((prev) => {
        const next = new Set(prev);
        if (sharing) next.add(socketId);
        else next.delete(socketId);
        return next;
      });

      // Fresh share (or a share ending) both start from a clean slate —
      // any leftover annotations from a previous share by this socketId
      // shouldn't bleed into the next one.
      removeScreenRef.current(socketId);

      if (!sharing) {
        closeIncomingScreenPeerRef.current(socketId);
        setRemoteScreenShares((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        setAnnotationAccessByScreen((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        setAnnotationRequests((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        setGrantedAnnotators((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
        setActiveAnnotationScreenOwnerId((prev) => (prev === socketId ? '' : prev));
      }
    };

    const onAnnotationAccessRequested = ({ screenOwnerId, requesterSocketId, requesterName }) => {
      if (screenOwnerId !== localSocketIdRef.current) return;
      setAnnotationRequests((prev) => ({
        ...prev,
        [screenOwnerId]: {
          ...(prev[screenOwnerId] || {}),
          [requesterSocketId]: {
            socketId: requesterSocketId,
            name: requesterName || 'Participant',
          },
        },
      }));
    };

    const onAnnotationAccessUpdated = ({ screenOwnerId, granted }) => {
      setAnnotationAccessByScreen((prev) => ({
        ...prev,
        [screenOwnerId]: granted ? 'granted' : 'none',
      }));
      if (granted) {
        setActiveAnnotationScreenOwnerId(screenOwnerId);
      } else {
        setActiveAnnotationScreenOwnerId((prev) => (prev === screenOwnerId ? '' : prev));
        setAnnotationTool(null);
      }
    };

    const onAnnotationAccessGrantUpdated = ({ screenOwnerId, socketId, name, granted }) => {
      setAnnotationRequests((prev) => {
        const nextForScreen = { ...(prev[screenOwnerId] || {}) };
        delete nextForScreen[socketId];
        return { ...prev, [screenOwnerId]: nextForScreen };
      });
      setGrantedAnnotators((prev) => {
        const nextForScreen = { ...(prev[screenOwnerId] || {}) };
        if (granted) nextForScreen[socketId] = { socketId, name: name || 'Participant' };
        else delete nextForScreen[socketId];
        return { ...prev, [screenOwnerId]: nextForScreen };
      });
    };

    const onAnnotationAccessRevoked = ({ screenOwnerId, socketId }) => {
      setGrantedAnnotators((prev) => {
        const nextForScreen = { ...(prev[screenOwnerId] || {}) };
        delete nextForScreen[socketId];
        return { ...prev, [screenOwnerId]: nextForScreen };
      });
    };

    const onChatMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (!showChatRef.current) setUnreadCount((c) => c + 1);
    };

    const onHostMuteAll = () => {
      const audioTracks = localStreamRef.current?.getAudioTracks() || [];
      audioTracks.forEach((t) => (t.enabled = false));
      if (!isMutedRef.current) {
        isMutedRef.current = true;
        toggleMute();
      }
      socket.emit('media-state', {
        roomId: localInfo.roomId,
        isMuted: true,
        isVideoOff: isVideoOffRef.current,
      });
    };

    const onHostMuteUser = () => {
      onHostMuteAll();
    };

    const onHostTransferred = ({ socketId }) => {
      if (socketId === localSocketIdRef.current) {
        setIsHost(true);
        isHostRef.current = true;
      }
      setRemoteParticipants((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((id) => {
          next[id] = { ...next[id], isHost: id === socketId };
        });
        return next;
      });
    };

    const onRemovedFromRoom = () => {
      alert('You were removed from the meeting by the host.');
      doLeave();
    };

    socket.on('room-joined', onRoomJoined);
    socket.on('user-joined', onUserJoined);
    socket.on('room-full', onRoomFull);
    socket.on('offer', onOffer);
    socket.on('answer', onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('user-left', onUserLeft);
    socket.on('peer-media-state', onPeerMediaState);
    socket.on('peer-hand-state', onPeerHandState);
    socket.on('peer-screen-share', onPeerScreenShare);
    socket.on('annotation-access-requested', onAnnotationAccessRequested);
    socket.on('annotation-access-updated', onAnnotationAccessUpdated);
    socket.on('annotation-access-grant-updated', onAnnotationAccessGrantUpdated);
    socket.on('annotation-access-revoked', onAnnotationAccessRevoked);
    socket.on('chat-message', onChatMessage);
    socket.on('host-mute-all', onHostMuteAll);
    socket.on('host-mute-user', onHostMuteUser);
    socket.on('host-transferred', onHostTransferred);
    socket.on('removed-from-room', onRemovedFromRoom);

    // Emit join AFTER listeners are registered
    console.log('[Room] Emitting join-room:', localInfo.roomId);
    socket.emit('join-room', {
      roomId: localInfo.roomId,
      userName: localInfo.name,
      isMuted: isMutedRef.current,
      isVideoOff: isVideoOffRef.current,
    });

    return () => {
      socket.off('room-joined', onRoomJoined);
      socket.off('user-joined', onUserJoined);
      socket.off('room-full', onRoomFull);
      socket.off('offer', onOffer);
      socket.off('answer', onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('user-left', onUserLeft);
      socket.off('peer-media-state', onPeerMediaState);
      socket.off('peer-hand-state', onPeerHandState);
      socket.off('peer-screen-share', onPeerScreenShare);
      socket.off('annotation-access-requested', onAnnotationAccessRequested);
      socket.off('annotation-access-updated', onAnnotationAccessUpdated);
      socket.off('annotation-access-grant-updated', onAnnotationAccessGrantUpdated);
      socket.off('annotation-access-revoked', onAnnotationAccessRevoked);
      socket.off('chat-message', onChatMessage);
      socket.off('host-mute-all', onHostMuteAll);
      socket.off('host-mute-user', onHostMuteUser);
      socket.off('host-transferred', onHostTransferred);
      socket.off('removed-from-room', onRemovedFromRoom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Media controls ───────────────────────────────────────────────
  const handleToggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newMuted = !isMutedRef.current;
    stream.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
    isMutedRef.current = newMuted;
    toggleMute();
    socket.emit('media-state', {
      roomId: localInfo.roomId,
      isMuted: newMuted,
      isVideoOff: isVideoOffRef.current,
    });
  }, [socket, localInfo, localStreamRef, toggleMute]);

  const handleToggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newVideoOff = !isVideoOffRef.current;
    stream.getVideoTracks().forEach((t) => (t.enabled = !newVideoOff));
    isVideoOffRef.current = newVideoOff;
    toggleVideo();
    socket.emit('media-state', {
      roomId: localInfo.roomId,
      isMuted: isMutedRef.current,
      isVideoOff: newVideoOff,
    });
  }, [socket, localInfo, localStreamRef, toggleVideo]);

  const handleToggleHand = useCallback(() => {
    setLocalHandRaised((raised) => {
      const nextRaised = !raised;
      socket.emit('hand-state', {
        roomId: localInfo.roomId,
        raised: nextRaised,
      });
      return nextRaised;
    });
  }, [socket, localInfo]);

  const replaceLocalStreamTracks = useCallback(async (oldStream, newStream) => {
    if (!oldStream || !newStream || oldStream === newStream) return;

    const oldAudioTrack = oldStream.getAudioTracks()[0] || null;
    const oldVideoTrack = oldStream.getVideoTracks()[0] || null;
    const newAudioTrack = newStream.getAudioTracks()[0] || null;
    const newVideoTrack = newStream.getVideoTracks()[0] || null;

    await Promise.all([
      replaceTrack(oldAudioTrack, newAudioTrack),
      replaceTrack(oldVideoTrack, newVideoTrack),
    ]);

    const nextTracks = new Set(newStream.getTracks());
    oldStream.getTracks().forEach((track) => {
      if (!nextTracks.has(track)) track.stop();
    });
  }, [replaceTrack]);

  const handleSwitchAudioDevice = useCallback(async (deviceId) => {
    const oldStream = localStreamRef.current;
    const newStream = await switchAudioDevice(deviceId);
    await replaceLocalStreamTracks(oldStream, newStream);
    return newStream;
  }, [localStreamRef, replaceLocalStreamTracks, switchAudioDevice]);

  const handleSwitchVideoDevice = useCallback(async (deviceId) => {
    const oldStream = localStreamRef.current;
    try {
      const newStream = await switchVideoDevice(deviceId);
      await replaceLocalStreamTracks(oldStream, newStream);
      return newStream;
    } catch (err) {
      if (err?.restoredStream) {
        await replaceLocalStreamTracks(oldStream, err.restoredStream);
      }
      throw err;
    }
  }, [localStreamRef, replaceLocalStreamTracks, switchVideoDevice]);

  // ── Screen sharing (Approach B: dedicated peer connections per share) ──
  // Camera PCs are never touched here — the sharer's own camera tile
  // stays visible the whole time, and a separate screen tile is added.
  //
  // stopScreenSharing is a dedicated, stable function (not routed through
  // handleToggleScreen). This matters because screenTrack.onended fires
  // from a browser event (native "Stop sharing" bar) whose handler was
  // registered at share-start time. If onended called handleToggleScreen
  // directly, it would re-invoke a closure where isScreenSharing was still
  // `false` (captured before the state update from starting the share),
  // causing it to run the START branch again instead of stopping — leaving
  // sockets/peer connections in a broken half-state. Branching on the ref
  // (isScreenSharingRef.current, always fresh) and calling this dedicated
  // stop function directly avoids that stale-closure bug entirely.
  const stopScreenSharing = useCallback(() => {
    stopScreenShare();
    socket.emit('screen-share-stopped', { roomId: localInfo.roomId });
    Object.keys(remoteParticipantsRef.current).forEach((id) => {
      closeOutgoingScreenPeerRef.current(id);
    });
    isScreenSharingRef.current = false;

    // The server never echoes 'peer-screen-share' back to the sender
    // (it uses socket.to(), which excludes the emitter), so we have to
    // remove our own id from activeSharerIds ourselves.
    setActiveSharerIds((prev) => {
      const next = new Set(prev);
      next.delete(localSocketIdRef.current);
      return next;
    });

    // Drop our own annotations and reset the toolbar for next time —
    // otherwise re-sharing later would resurrect stale shapes/tool state.
    removeScreenRef.current(localSocketIdRef.current);
    setAnnotationTool(null);
    setAnnotationRequests((prev) => {
      const next = { ...prev };
      delete next[localSocketIdRef.current];
      return next;
    });
    setGrantedAnnotators((prev) => {
      const next = { ...prev };
      delete next[localSocketIdRef.current];
      return next;
    });
    setActiveAnnotationScreenOwnerId((prev) =>
      prev === localSocketIdRef.current ? '' : prev
    );

    // If we were the pinned/primary share, clear the pin so the layout
    // falls back to whatever is left (single share, split, or grid).
    setPinnedScreenId((prev) =>
      prev === `${localSocketIdRef.current}-screen` ? null : prev
    );
  }, [stopScreenShare, socket, localInfo]);

  const handleToggleScreen = useCallback(async () => {
    // Branch on the ref, not the `isScreenSharing` state/prop — the state
    // can be stale inside closures (e.g. screenTrack.onended) that were
    // created before a React re-render picked up the new value.
    if (isScreenSharingRef.current) {
      stopScreenSharing();
      return;
    }

    // Feature-detect getDisplayMedia — it's unavailable on iOS Safari
    // (and Chrome-on-iOS, since it's WebKit under the hood) and some
    // embedded webviews. Without this check the button fails silently.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Screen sharing isn\'t supported in this browser. Try a desktop browser instead.');
      return;
    }

    // Client-side pre-check for instant feedback — server is still
    // the source of truth and will reject via the ack if this is stale.
    if (activeSharerIds.size >= MAX_SCREEN_SHARES) {
      alert(`Only ${MAX_SCREEN_SHARES} people can share their screen at the same time. Please wait for a slot to free up.`);
      return;
    }

    try {
      const screenStream = await startScreenShare();
      const screenTrack = screenStream.getVideoTracks()[0];

      socket.emit('screen-share-started', { roomId: localInfo.roomId }, (res) => {
        if (!res?.ok) {
          stopScreenShare();
          alert(`Only ${res?.max ?? MAX_SCREEN_SHARES} people can share their screen at once. Please try again shortly.`);
          return;
        }

        isScreenSharingRef.current = true;

        // The sharer needs to know about their own active share too —
        // the server only broadcasts to *other* sockets in the room.
        setActiveSharerIds((prev) => new Set(prev).add(localSocketIdRef.current));

        // Send the FULL screen stream (video + audio, when granted) to
        // every current remote participant.
        Object.keys(remoteParticipantsRef.current).forEach((id) => {
          makeScreenOfferRef.current(id, screenStream);
        });
      });

      // Call the stable stop function directly — NOT handleToggleScreen —
      // so the browser's native "Stop sharing" button runs the exact same
      // cleanup path as our own Stop button, regardless of closure staleness.
      screenTrack.onended = () => stopScreenSharing();
    } catch (err) {
      console.error('Screen share failed:', err);
      // NotAllowedError just means the user cancelled the picker — no
      // need to alert them about their own choice.
      if (err?.name !== 'NotAllowedError') {
        alert('Could not start screen sharing. Please check your browser permissions and try again.');
      }
    }
  }, [startScreenShare, stopScreenShare, stopScreenSharing, socket, localInfo, activeSharerIds]);

  const handleSendMessage = useCallback(
    (text) => socket.emit('chat-message', { roomId: localInfo.roomId, message: text }),
    [socket, localInfo]
  );

  const doLeave = useCallback(() => {
    if (isRecording) stopRecording();
    if (isScreenSharingRef.current) {
      socket.emit('screen-share-stopped', { roomId: localInfo.roomId });
    }
    closeAll();
    closeAllScreenPeers();
    stopAll();
    onLeave();
  }, [isRecording, stopRecording, closeAll, closeAllScreenPeers, stopAll, onLeave, socket, localInfo]);

  const handleMuteAll = useCallback(() => {
    socket.emit('mute-all', { roomId: localInfo.roomId });
  }, [socket, localInfo]);

  const handleRemoveUser = useCallback(
    (targetSocketId) => socket.emit('remove-user', { roomId: localInfo.roomId, targetSocketId }),
    [socket, localInfo]
  );

  const handleRequestAnnotationAccess = useCallback((screenOwnerId) => {
    setAnnotationAccessByScreen((prev) => ({ ...prev, [screenOwnerId]: 'pending' }));
    socket.emit('annotation-request-access', {
      roomId: localInfo.roomId,
      screenOwnerId,
    }, (res) => {
      if (!res?.ok) {
        setAnnotationAccessByScreen((prev) => ({ ...prev, [screenOwnerId]: 'none' }));
        alert('Could not request drawing access for this screen share.');
      }
    });
  }, [socket, localInfo]);

  const handleAnnotationAccessResponse = useCallback((requesterSocketId, approved) => {
    socket.emit('annotation-access-response', {
      roomId: localInfo.roomId,
      requesterSocketId,
      approved,
    });
  }, [socket, localInfo]);

  const handleRevokeAnnotationAccess = useCallback((targetSocketId) => {
    socket.emit('annotation-access-revoke', {
      roomId: localInfo.roomId,
      screenOwnerId: localSocketIdRef.current,
      targetSocketId,
    });
  }, [socket, localInfo]);

  const handleCopyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(localInfo.roomId);
    } catch (err) {
      console.warn('[Room] Could not copy room ID:', err);
    }
  }, [localInfo]);

  const handleCopyInviteLink = useCallback(async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', localInfo.roomId);
      await navigator.clipboard?.writeText(url.toString());
    } catch (err) {
      console.warn('[Room] Could not copy invite link:', err);
    }
  }, [localInfo]);

  const handleToggleChat = () => {
    setShowChat((s) => !s);
    if (showRecording) setShowRecording(false);
    if (showParticipants) setShowParticipants(false);
    setUnreadCount(0);
  };

  const handleToggleParticipants = () => {
    setShowParticipants((s) => !s);
    if (showChat) setShowChat(false);
    if (showRecording) setShowRecording(false);
  };

  const handleToggleRecording = () => {
    setShowRecording((s) => !s);
    if (showChat) setShowChat(false);
    if (showParticipants) setShowParticipants(false);
  };

  // ── Annotation handlers (sharer-only — see AnnotationToolbar) ────
  const getParticipantName = useCallback((socketId) => {
    if (socketId === localSocketId) return localInfo.name;
    return remoteParticipants[socketId]?.name || 'Participant';
  }, [localSocketId, localInfo, remoteParticipants]);

  const drawableAnnotationTargets = [
    ...(isScreenSharing
      ? [{ id: localSocketId, label: `${localInfo.name} screen` }]
      : []),
    ...Object.keys(remoteScreenShares)
      .filter((id) => annotationAccessByScreen[id] === 'granted')
      .map((id) => ({ id, label: `${getParticipantName(id)} screen` })),
  ].filter((target) => target.id);

  const effectiveActiveAnnotationScreenOwnerId = drawableAnnotationTargets.some(
    (target) => target.id === activeAnnotationScreenOwnerId
  )
    ? activeAnnotationScreenOwnerId
    : drawableAnnotationTargets[0]?.id || '';

  const handleAnnotationAddShape = useCallback(
    (screenOwnerId, shape) => addShape(screenOwnerId, shape),
    [addShape]
  );
  const handleAnnotationUndo = useCallback(
    () => {
      if (effectiveActiveAnnotationScreenOwnerId) {
        undoLastShape(effectiveActiveAnnotationScreenOwnerId);
      }
    },
    [undoLastShape, effectiveActiveAnnotationScreenOwnerId]
  );
  const handleAnnotationClear = useCallback(
    () => {
      if (effectiveActiveAnnotationScreenOwnerId) {
        clearShapes(effectiveActiveAnnotationScreenOwnerId);
      }
    },
    [clearShapes, effectiveActiveAnnotationScreenOwnerId]
  );

  // Build participant list (camera tiles only — screen shares are separate)
  const allParticipants = [
    {
      socketId: localSocketId,
      stream: localStream,
      name: localInfo.name,
      isHost,
      isMuted,
      isVideoOff,
      isLocal: true,
      isScreenShare: false,
      handRaised: localHandRaised,
    },
    ...Object.entries(remoteParticipants).map(([id, data]) => ({
      socketId: id,
      ...data,
      isLocal: false,
      isScreenShare: false,
    })),
  ];

  // Build screen-share tile list (local + remote), rendered separately
  // and full-width via the existing .video-tile.screen-share CSS class.
  // Each tile carries an `annotation` payload so VideoTile can render the
  // overlay — only the local sharer's own tile gets `isOwner: true`.
  const screenTiles = [
    ...(isScreenSharing
      ? [{
          socketId: `${localSocketId}-screen`,
          stream: screenStreamRef.current,
          name: localInfo.name,
          isLocal: true,
          isScreenShare: true,
          annotation: {
            shapes: shapesByScreen[localSocketId] || [],
            isOwner: true,
            tool: effectiveActiveAnnotationScreenOwnerId === localSocketId ? annotationTool : null,
            color: annotationColor,
            onAddShape: (shape) => handleAnnotationAddShape(localSocketId, shape),
          },
        }]
      : []),
    ...Object.entries(remoteScreenShares).map(([id, stream]) => {
      const accessStatus = annotationAccessByScreen[id] || 'none';
      const canAnnotateScreen = accessStatus === 'granted';
      return {
        socketId: `${id}-screen`,
        stream,
        name: remoteParticipants[id]?.name || 'Participant',
        isLocal: false,
        isScreenShare: true,
        annotation: {
          shapes: shapesByScreen[id] || [],
          isOwner: canAnnotateScreen,
          tool: canAnnotateScreen && effectiveActiveAnnotationScreenOwnerId === id ? annotationTool : null,
          color: annotationColor,
          onAddShape: (shape) => handleAnnotationAddShape(id, shape),
        },
        annotationAccess: {
          visible: true,
          status: accessStatus,
          disabled: accessStatus === 'pending',
          label:
            accessStatus === 'granted'
              ? effectiveActiveAnnotationScreenOwnerId === id ? 'Drawing' : 'Draw'
              : accessStatus === 'pending'
              ? 'Requested'
              : 'Request draw',
          title:
            accessStatus === 'granted'
              ? 'Select this screen as your annotation target'
              : 'Ask the presenter for permission to draw on this screen',
          onClick: () => {
            if (accessStatus === 'granted') {
              setActiveAnnotationScreenOwnerId(id);
            } else if (accessStatus !== 'pending') {
              handleRequestAnnotationAccess(id);
            }
          },
        },
      };
    }),
  ];

  const count = allParticipants.length;
  const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
  const raisedHandCount = allParticipants.filter((p) => p.handRaised).length;

  // ── Screen-share presentation layout ────────────────────────────
  // A pin only counts if that screen share is still active.
  const validPinnedScreenId = screenTiles.some((t) => t.socketId === pinnedScreenId)
    ? pinnedScreenId
    : null;

  let mainScreenTiles = [];
  let sidebarScreenTiles = [];
  if (screenTiles.length === 1) {
    // Only one share active — it always owns the main area.
    mainScreenTiles = screenTiles;
  } else if (screenTiles.length >= 2) {
    if (validPinnedScreenId) {
      // Someone picked a primary — that one goes full-width, the other
      // active share drops into the sidebar alongside the camera tiles.
      mainScreenTiles = screenTiles.filter((t) => t.socketId === validPinnedScreenId);
      sidebarScreenTiles = screenTiles.filter((t) => t.socketId !== validPinnedScreenId);
    } else {
      // No one has pinned a primary yet — split the main area vertically
      // so both shares sit side by side instead of stacking with cameras.
      mainScreenTiles = screenTiles;
    }
  }
  const hasScreenShare = screenTiles.length > 0;

  // Whether the local user is still allowed to start a new share
  const canShareScreen = isScreenSharing || activeSharerIds.size < MAX_SCREEN_SHARES;
  const pendingAnnotationRequests = Object.values(annotationRequests[localSocketId] || {});
  const activeGrantedAnnotators = Object.values(grantedAnnotators[localSocketId] || {});
  const showAnnotationDock =
    drawableAnnotationTargets.length > 0 ||
    (isScreenSharing && (pendingAnnotationRequests.length > 0 || activeGrantedAnnotators.length > 0));

  // ── Room Full overlay ────────────────────────────────────────────
  if (roomFullError) {
    return (
      <div className="error-screen">
        <div className="error-card">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <h2>Room is Full</h2>
          <p>This room already has 6 participants, which is the maximum allowed. Please try again later or join a different room.</p>
          <button onClick={onLeave}>Back to Lobby</button>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      {/* Recording indicator in header when active */}
      {isRecording && (
        <div className="recording-topbar">
          <span className="rec-dot-sm" />
          Recording — {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:{String(recordingDuration % 60).padStart(2, '0')}
        </div>
      )}

      <div className="room-header">
        <div className="logo-sm">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="#3b82f6" />
            <path d="M8 12h10v8H8z" fill="white" />
            <path d="M20 14l4-2v8l-4-2v-4z" fill="white" />
          </svg>
          NexMeet
        </div>
        <div className="room-info">
          <span className="participant-count-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {count}/6
          </span>
          {raisedHandCount > 0 && (
            <span className="participant-count-tag" title="Raised hands">
              Hand {raisedHandCount}
            </span>
          )}
          {activeSharerIds.size > 0 && (
            <span className="participant-count-tag" title="Active screen shares">
              🖥️ {activeSharerIds.size}/{MAX_SCREEN_SHARES}
            </span>
          )}
          <span className="room-id-tag">Room: {localInfo.roomId}</span>
          <button
            className="copy-room-btn"
            onClick={handleCopyRoomId}
          >
            Copy
          </button>
          <button
            className="copy-room-btn"
            onClick={handleCopyInviteLink}
          >
            Copy Link
          </button>
        </div>
      </div>

      {showAnnotationDock && (
        <div className="annotation-controls-dock">
          {drawableAnnotationTargets.length > 0 && (
            <AnnotationToolbar
              tool={annotationTool}
              onSelectTool={setAnnotationTool}
              color={annotationColor}
              onSelectColor={setAnnotationColor}
              onUndo={handleAnnotationUndo}
              onClear={handleAnnotationClear}
              targets={drawableAnnotationTargets}
              activeTargetId={effectiveActiveAnnotationScreenOwnerId}
              onSelectTarget={setActiveAnnotationScreenOwnerId}
            />
          )}
          {isScreenSharing && (pendingAnnotationRequests.length > 0 || activeGrantedAnnotators.length > 0) && (
            <div className="annotation-access-panel">
              {pendingAnnotationRequests.map((request) => (
                <div key={request.socketId} className="annotation-access-row">
                  <span>{request.name} wants to draw</span>
                  <button type="button" onClick={() => handleAnnotationAccessResponse(request.socketId, true)}>
                    Allow
                  </button>
                  <button type="button" className="danger" onClick={() => handleAnnotationAccessResponse(request.socketId, false)}>
                    Deny
                  </button>
                </div>
              ))}
              {activeGrantedAnnotators.map((drawer) => (
                <div key={drawer.socketId} className="annotation-access-row granted">
                  <span>{drawer.name} can draw</span>
                  <button type="button" className="danger" onClick={() => handleRevokeAnnotationAccess(drawer.socketId)}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="room-body">
        {hasScreenShare ? (
          <div className="presentation-layout">
            {/* Main area — the primary screen share (or both, split, if unpinned) */}
            <div className={`presentation-main ${mainScreenTiles.length > 1 ? 'split' : ''}`}>
              {/* Sharer-only drawing toolbar — only relevant while the local
                  user is presenting, so it's mounted here rather than inside
                  a specific tile (which may move between main/sidebar). */}
              {mainScreenTiles.map((p) => (
                <VideoTile
                  key={p.socketId}
                  stream={p.stream}
                  participant={p}
                  isLocal={p.isLocal}
                  isScreenShare
                  isPrimary={mainScreenTiles.length === 1}
                  showPrimaryButton={mainScreenTiles.length > 1}
                  onSetPrimary={() => setPinnedScreenId(p.socketId)}
                  annotation={p.annotation}
                  annotationAccess={p.annotationAccess}
                />
              ))}
              {validPinnedScreenId && screenTiles.length === 2 && (
                <button
                  type="button"
                  className="presentation-mode-toggle"
                  onClick={() => setPinnedScreenId(null)}
                >
                  Show Side by Side
                </button>
              )}
            </div>

            {/* Sidebar — secondary screen share(s) + all camera tiles */}
            <div className="presentation-sidebar">
              {sidebarScreenTiles.map((p) => (
                <VideoTile
                  key={p.socketId}
                  stream={p.stream}
                  participant={p}
                  isLocal={p.isLocal}
                  isScreenShare
                  showPrimaryButton
                  onSetPrimary={() => setPinnedScreenId(p.socketId)}
                  annotation={p.annotation}
                  annotationAccess={p.annotationAccess}
                />
              ))}
              {allParticipants.map((p) => (
                <VideoTile
                  key={p.socketId}
                  stream={p.stream}
                  participant={p}
                  isLocal={p.isLocal}
                  isScreenShare={false}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="video-grid" style={{ '--grid-cols': cols }}>
            {allParticipants.map((p) => (
              <VideoTile
                key={p.socketId}
                stream={p.stream}
                participant={p}
                isLocal={p.isLocal}
                isScreenShare={false}
              />
            ))}
          </div>
        )}

        {showChat && (
          <ChatPanel
            messages={messages}
            onSend={handleSendMessage}
            localSocketId={localSocketId}
            onClose={handleToggleChat}
          />
        )}
        {showParticipants && (
          <ParticipantsPanel
            participants={allParticipants.map((p) => ({
              socketId: p.socketId,
              name: p.name,
              isHost: p.isHost,
              isMuted: p.isMuted,
              isVideoOff: p.isVideoOff,
              handRaised: p.handRaised,
            }))}
            isHost={isHost}
            localSocketId={localSocketId}
            onMuteUser={(id) => socket.emit('mute-user', { roomId: localInfo.roomId, targetSocketId: id })}
            onRemoveUser={handleRemoveUser}
            onClose={handleToggleParticipants}
          />
        )}
        {showRecording && (
          <RecordingPanel
            isRecording={isRecording}
            duration={recordingDuration}
            lastBlob={lastBlob}
            participantCount={count}
            onStart={() =>
              startRecording(
                [...screenTiles, ...allParticipants].map((p) => ({
                  name: p.name,
                  stream: p.stream,
                  isLocal: p.isLocal,
                }))
              )
            }
            onStop={stopRecording}
            onDownload={() => downloadRecording(`nexmeet-${localInfo.roomId}-${Date.now()}.webm`)}
            onDismiss={clearRecording}
            onClose={handleToggleRecording}
          />
        )}
      </div>

      <Controls
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        hasAudioTrack={hasAudioTrack}
        hasVideoTrack={hasVideoTrack}
        isScreenSharing={isScreenSharing}
        isRecording={isRecording}
        isHandRaised={localHandRaised}
        canShareScreen={canShareScreen}
        onToggleMute={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        onToggleHand={handleToggleHand}
        onToggleScreen={handleToggleScreen}
        onLeave={doLeave}
        onToggleChat={handleToggleChat}
        onToggleParticipants={handleToggleParticipants}
        onToggleRecording={handleToggleRecording}
        showChat={showChat}
        showParticipants={showParticipants}
        showRecording={showRecording}
        unreadCount={unreadCount}
        isHost={isHost}
        onMuteAll={handleMuteAll}
        devices={devices}
        selectedDevices={selectedDevices}
        onSwitchAudio={handleSwitchAudioDevice}
        onSwitchVideo={handleSwitchVideoDevice}
        onSwitchSpeaker={setSpeakerDevice}
      />
    </div>
  );
}
