import { useEffect, useState, useCallback, useRef } from 'react';
import { usePeerConnections } from '../hooks/usePeerConnections';
import { useRecording } from '../hooks/useRecording';
import { VideoTile } from './VideoTile';
import { Controls } from './Controls';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RecordingPanel } from './RecordingPanel';

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

  // ── Recording hook ──────────────────────────────────────────────
  const {
    isRecording, recordingDuration, lastBlob,
    startRecording, stopRecording, downloadRecording, clearRecording,
  } = useRecording();

  // ── Remote stream / peer left ────────────────────────────────────
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

  const {
    makeOffer, handleOffer, handleAnswer,
    handleIceCandidate, closePeer, closeAll, replaceTrack,
  } = usePeerConnections({
    socket,
    localStreamRef,
    onRemoteStream: handleRemoteStream,
    onPeerLeft: handlePeerLeft,
  });

  // Stable refs for WebRTC fns
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

  // ── Register socket listeners ONCE, then emit join-room ─────────
  useEffect(() => {
    if (!socket) return;

    const onRoomJoined = ({ socketId, isHost: amHost, participants }) => {
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
    };

    const onUserJoined = ({ socketId, name, isHost: theirHost }) => {
      console.log('[Room] user-joined:', socketId, name);
      setRemoteParticipants((prev) => ({
        ...prev,
        [socketId]: {
          ...(prev[socketId] || {}),
          name,
          isHost: theirHost,
          isMuted: false,
          isVideoOff: false,
        },
      }));
    };

    const onRoomFull = ({ max }) => {
      console.warn(`[Room] Room is full (max ${max})`);
      setRoomFullError(true);
    };

    const onOffer = async ({ from, offer }) => {
      console.log('[Room] received offer from:', from);
      await handleOfferRef.current(from, offer);
    };

    const onAnswer = async ({ from, answer }) => {
      console.log('[Room] received answer from:', from);
      await handleAnswerRef.current(from, answer);
    };

    const onIceCandidate = async ({ from, candidate }) => {
      await handleIceCandidateRef.current(from, candidate);
    };

    const onUserLeft = ({ socketId }) => {
      console.log('[Room] user-left:', socketId);
      closePeerRef.current(socketId);
      handlePeerLeftRef.current(socketId);
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
    socket.emit('join-room', { roomId: localInfo.roomId, userName: localInfo.name });

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

  const handleToggleScreen = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare();
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) await replaceTrack(camTrack, camTrack);
      socket.emit('screen-share-stopped', { roomId: localInfo.roomId });
    } else {
      try {
        const screenStream = await startScreenShare();
        const screenTrack = screenStream.getVideoTracks()[0];
        const camTrack = localStreamRef.current?.getVideoTracks()[0];
        if (camTrack) await replaceTrack(camTrack, screenTrack);
        screenSenderRef.current = screenTrack;
        socket.emit('screen-share-started', { roomId: localInfo.roomId });
        screenTrack.onended = () => handleToggleScreen();
      } catch (err) {
        console.error('Screen share failed:', err);
      }
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare, replaceTrack, socket, localInfo, localStreamRef]);

  const handleSendMessage = useCallback(
    (text) => socket.emit('chat-message', { roomId: localInfo.roomId, message: text }),
    [socket, localInfo]
  );

  const doLeave = useCallback(() => {
    if (isRecording) stopRecording();
    closeAll();
    stopAll();
    onLeave();
  }, [isRecording, stopRecording, closeAll, stopAll, onLeave]);

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

  // Build participant list for recording
  const allParticipants = [
    {
      socketId: localSocketId,
      stream: isScreenSharing ? screenStreamRef.current : localStream,
      name: localInfo.name,
      isHost,
      isMuted,
      isVideoOff,
      isLocal: true,
      isScreenShare: isScreenSharing,
    },
    ...Object.entries(remoteParticipants).map(([id, data]) => ({
      socketId: id,
      ...data,
      isLocal: false,
    })),
  ];

  const count = allParticipants.length;
  const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;

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
          {allParticipants.map((p) => (
            <VideoTile
              key={p.socketId}
              stream={p.stream}
              participant={p}
              isLocal={p.isLocal}
              isScreenShare={p.isScreenShare}
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
                allParticipants.map((p) => ({
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
