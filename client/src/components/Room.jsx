import { useEffect, useState, useCallback, useRef } from 'react';
import { usePeerConnections } from '../hooks/usePeerConnections';
import { useRecording } from '../hooks/useRecording';
import { VideoTile } from './VideoTile';
import { Controls } from './Controls';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RecordingPanel } from './RecordingPanel';

const MAX_SCREEN_SHARES = 2;

export function Room({ socket, localInfo, mediaState, onLeave }) {
  const {
    localStream, localStreamRef, screenStreamRef,
    isMuted, isVideoOff, isScreenSharing,
    devices, selectedDevices,
    toggleMute, toggleVideo,
    startScreenShare, stopScreenShare,
    switchAudioDevice, switchVideoDevice, setSpeakerDevice,
    stopAll,
  } = mediaState;

  const [remoteParticipants, setRemoteParticipants] = useState({});
  const [remoteScreenShares, setRemoteScreenShares] = useState({}); // socketId -> MediaStream
  const [activeSharerIds, setActiveSharerIds] = useState(new Set()); // socketIds currently sharing (remote + tracked for local too)
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showRecording, setShowRecording] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [localSocketId, setLocalSocketId] = useState('');
  const [roomFullError, setRoomFullError] = useState(false);
  const screenSenderRef = useRef(null);

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
  const screenTrackRef = useRef(null);

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
    handleScreenIceCandidate, closeScreenPeer, closeAllScreenPeers,
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
  const closeScreenPeerRef = useRef(closeScreenPeer);
  useEffect(() => { makeScreenOfferRef.current = makeScreenOffer; }, [makeScreenOffer]);
  useEffect(() => { handleScreenOfferRef.current = handleScreenOffer; }, [handleScreenOffer]);
  useEffect(() => { handleScreenAnswerRef.current = handleScreenAnswer; }, [handleScreenAnswer]);
  useEffect(() => { handleScreenIceCandidateRef.current = handleScreenIceCandidate; }, [handleScreenIceCandidate]);
  useEffect(() => { closeScreenPeerRef.current = closeScreenPeer; }, [closeScreenPeer]);

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

    const onUserJoined = ({ socketId, name, isHost: theirHost, isMuted: theirMuted, isVideoOff: theirVideoOff }) => {
      console.log('[Room] user-joined:', socketId, name);
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: {
          ...(prev[socketId] || {}),
          name,
          isHost: theirHost,
          isMuted: Boolean(theirMuted),
          isVideoOff: Boolean(theirVideoOff),
        },
      }));

      // If I'm currently sharing my screen, extend that share to the newcomer
      if (isScreenSharingRef.current && screenTrackRef.current) {
        console.log('[Room] Extending active screen share to newcomer:', socketId);
        makeScreenOfferRef.current(socketId, screenTrackRef.current);
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
    };

    const onPeerMediaState = ({ socketId, isMuted: m, isVideoOff: v }) => {
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: { ...(prev[socketId] || {}), isMuted: m, isVideoOff: v },
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

      if (!sharing) {
        closeScreenPeerRef.current(socketId);
        setRemoteScreenShares((prev) => {
          const next = { ...prev };
          delete next[socketId];
          return next;
        });
      }
    };

    const onChatMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (!showChatRef.current) setUnreadCount((c) => c + 1);
    };

    const onHostMuteAll = () => {
      const audioTracks = localStreamRef.current?.getAudioTracks() || [];
      audioTracks.forEach((t) => (t.enabled = false));
      socket.emit('media-state', {
        roomId: localInfo.roomId,
        isMuted: true,
        isVideoOff: isVideoOffRef.current,
      });
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
    socket.on('peer-screen-share', onPeerScreenShare);
    socket.on('chat-message', onChatMessage);
    socket.on('host-mute-all', onHostMuteAll);
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
      socket.off('peer-screen-share', onPeerScreenShare);
      socket.off('chat-message', onChatMessage);
      socket.off('host-mute-all', onHostMuteAll);
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

  // ── Screen sharing (Approach B: dedicated peer connections per share) ──
  // Camera PCs are never touched here — the sharer's own camera tile
  // stays visible the whole time, and a separate screen tile is added.
  const handleToggleScreen = useCallback(async () => {
    if (isScreenSharing) {
      // ── Stop sharing ──
      stopScreenShare();
      socket.emit('screen-share-stopped', { roomId: localInfo.roomId });
      Object.keys(remoteParticipantsRef.current).forEach((id) => {
        closeScreenPeerRef.current(id);
      });
      isScreenSharingRef.current = false;
      screenTrackRef.current = null;
      screenSenderRef.current = null;
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
        screenTrackRef.current = screenTrack;
        screenSenderRef.current = screenTrack;

        // Send this screen track to every current remote participant
        Object.keys(remoteParticipantsRef.current).forEach((id) => {
          makeScreenOfferRef.current(id, screenTrack);
        });
      });

      screenTrack.onended = () => handleToggleScreen();
    } catch (err) {
      console.error('Screen share failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScreenSharing, startScreenShare, stopScreenShare, socket, localInfo, activeSharerIds]);

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
  const screenTiles = [
    ...(isScreenSharing
      ? [{
          socketId: `${localSocketId}-screen`,
          stream: screenStreamRef.current,
          name: localInfo.name,
          isLocal: true,
          isScreenShare: true,
        }]
      : []),
    ...Object.entries(remoteScreenShares).map(([id, stream]) => ({
      socketId: `${id}-screen`,
      stream,
      name: remoteParticipants[id]?.name || 'Participant',
      isLocal: false,
      isScreenShare: true,
    })),
  ];

  const count = allParticipants.length;
  const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;

  // Whether the local user is still allowed to start a new share
  const canShareScreen = isScreenSharing || activeSharerIds.size < MAX_SCREEN_SHARES;

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
          {activeSharerIds.size > 0 && (
            <span className="participant-count-tag" title="Active screen shares">
              🖥️ {activeSharerIds.size}/{MAX_SCREEN_SHARES}
            </span>
          )}
          <span className="room-id-tag">Room: {localInfo.roomId}</span>
          <button
            className="copy-room-btn"
            onClick={() => navigator.clipboard.writeText(localInfo.roomId)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="room-body">
        <div className="video-grid" style={{ '--grid-cols': cols }}>
          {/* Screen-share tiles first — full width per existing CSS */}
          {screenTiles.map((p) => (
            <VideoTile
              key={p.socketId}
              stream={p.stream}
              participant={p}
              isLocal={p.isLocal}
              isScreenShare
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

        {showChat && (
          <ChatPanel
            messages={messages}
            onSend={handleSendMessage}
            localSocketId={localSocketId}
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
            }))}
            isHost={isHost}
            localSocketId={localSocketId}
            onMuteUser={(id) => socket.emit('mute-user', { roomId: localInfo.roomId, targetSocketId: id })}
            onRemoveUser={handleRemoveUser}
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
          />
        )}
      </div>

      <Controls
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        isScreenSharing={isScreenSharing}
        isRecording={isRecording}
        canShareScreen={canShareScreen}
        onToggleMute={handleToggleMute}
        onToggleVideo={handleToggleVideo}
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
        onSwitchAudio={switchAudioDevice}
        onSwitchVideo={switchVideoDevice}
        onSwitchSpeaker={setSpeakerDevice}
      />
    </div>
  );
}
