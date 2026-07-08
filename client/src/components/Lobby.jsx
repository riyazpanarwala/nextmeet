import { useState, useEffect, useRef } from 'react';

export function Lobby({ onJoin, inviteRoomId = '' }) {
  const normalizedInviteRoomId = inviteRoomId.trim().toUpperCase();
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState(normalizedInviteRoomId);
  const [tab, setTab] = useState(normalizedInviteRoomId ? 'join' : 'new'); // 'new' | 'join'
  const [preview, setPreview] = useState(null);
  const [permError, setPermError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    setRoomId(Math.random().toString(36).slice(2, 8).toUpperCase());
    startPreview();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (videoRef.current && preview) videoRef.current.srcObject = preview;
  }, [preview, isVideoOff]);

  useEffect(() => {
    if (!normalizedInviteRoomId) return;
    setJoinRoomId(normalizedInviteRoomId);
    setTab('join');
  }, [normalizedInviteRoomId]);

  const startPreview = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera preview requires HTTPS or localhost in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 360, max: 720 },
          frameRate: { ideal: 15, max: 24 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setPreview(stream);
      setPermError('');
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      if (err?.message) {
        setPermError(err.message);
        return;
      }
      setPermError('Camera access denied — you can still join audio-only.');
    }
  };

  const togglePreviewVideo = async () => {
    if (isVideoOff) {
      setIsVideoOff(false);
      if (!streamRef.current?.getVideoTracks().length) await startPreview();
      streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = true; });
      return;
    }

    setIsVideoOff(true);
    streamRef.current?.getVideoTracks().forEach((track) => { track.enabled = false; });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(tab === 'new' ? roomId : joinRoomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleJoin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const finalRoomId = (normalizedInviteRoomId || (tab === 'new' ? roomId : joinRoomId)).trim().toUpperCase();
    if (!finalRoomId) return;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onJoin({ name: trimmedName, roomId: finalRoomId, isMuted, isVideoOff });
  };

  const handleKey = (e) => { if (e.key === 'Enter') handleJoin(); };

  return (
    <div className="lobby">
      <div className="lobby-card">

        {/* Camera preview */}
        <div className="lobby-preview">
          {isVideoOff
            ? <div className="preview-off" aria-label="Camera is off">
                <span>{name.trim().charAt(0).toUpperCase() || '?'}</span>
                <p>Camera is off</p>
              </div>
            : permError
            ? <div className="preview-error">{permError}</div>
            : <video ref={videoRef} autoPlay muted playsInline />
          }
          <div className="preview-label">Preview</div>
          <div className="preview-controls" aria-label="Pre-join media controls">
            <button
              type="button"
              className={`preview-control ${isMuted ? 'off' : ''}`}
              onClick={() => setIsMuted((muted) => !muted)}
              aria-pressed={isMuted}
              title={isMuted ? 'Turn microphone on' : 'Mute microphone'}
            >
              {isMuted ? 'Mic off' : 'Mic on'}
            </button>
            <button
              type="button"
              className={`preview-control ${isVideoOff ? 'off' : ''}`}
              onClick={togglePreviewVideo}
              aria-pressed={isVideoOff}
              title={isVideoOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {isVideoOff ? 'Camera off' : 'Camera on'}
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="lobby-form">
          <div className="logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="#3b82f6"/>
              <path d="M8 12h10v8H8z" fill="white"/>
              <path d="M20 14l4-2v8l-4-2v-4z" fill="white"/>
            </svg>
            <span>NexMeet</span>
          </div>

          <h1>Ready to join?</h1>

          {!normalizedInviteRoomId && (
            <div className="lobby-tabs" role="tablist">
              <button
                role="tab"
                className={`lobby-tab ${tab === 'new' ? 'active' : ''}`}
                onClick={() => setTab('new')}
              >
                New Room
              </button>
              <button
                role="tab"
                className={`lobby-tab ${tab === 'join' ? 'active' : ''}`}
                onClick={() => setTab('join')}
              >
                Join Existing
              </button>
            </div>
          )}

          {/* Name */}
          <label htmlFor="user-name">Your Name</label>
          <input
            id="user-name"
            type="text"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKey}
            autoComplete="name"
          />

          {/* Room ID fields */}
          {normalizedInviteRoomId ? (
            <p className="room-share-hint invite-room-hint">
              Joining room from shared link
            </p>
          ) : tab === 'new' ? (
            <>
              <label>Your Room ID</label>
              <div className="room-id-row">
                <input
                  type="text"
                  value={roomId}
                  readOnly
                  className="room-id-input"
                />
                <button className="copy-btn" onClick={handleCopy} title="Copy room ID">
                  {copied
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  }
                </button>
              </div>
              <p className="room-share-hint">Share this ID with people you want to invite</p>
            </>
          ) : (
            <>
              <label htmlFor="join-room-id">Room ID</label>
              <input
                id="join-room-id"
                type="text"
                placeholder="Enter room ID (e.g. AB12CD)"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                onKeyDown={handleKey}
                autoCapitalize="characters"
              />
            </>
          )}

          <button
            className="join-btn"
            onClick={handleJoin}
            disabled={!name.trim() || (tab === 'join' && !joinRoomId.trim())}
          >
            {tab === 'new' && !normalizedInviteRoomId ? 'Start Meeting' : 'Join Meeting'}
          </button>

          <p className="lobby-footer">
            Max 6 participants per room · Local recording supported
          </p>
        </div>
      </div>
    </div>
  );
}
