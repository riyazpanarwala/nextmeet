import { useEffect, useRef, useState, useCallback } from 'react';
import { useAudioLevel } from '../hooks/useAudioLevel';

export function VideoTile({
  stream,
  participant,
  isLocal,
  isScreenShare,
  onSetPrimary,       // called when the user wants this tile to become the main view
  showPrimaryButton,  // show the "Set as Main" control (only relevant for screen shares)
  isPrimary,          // this tile IS the current main view — shows a "Presenting" badge
}) {
  const videoRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    // Only set srcObject when stream actually changes to avoid re-triggering
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    // LOCAL video must be muted to prevent mic echo feedback.
    // REMOTE videos must NEVER be muted — that is the audio bug.
    video.muted = !!isLocal;
  }, [stream, isLocal]);

  const handleSpeaking = useCallback((speaking) => {
    setIsSpeaking(speaking);
  }, []);

  useAudioLevel(isLocal ? stream : null, handleSpeaking);

  const initials = (participant?.name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`video-tile ${isSpeaking ? 'speaking' : ''} ${isScreenShare ? 'screen-share' : ''}`}
    >
      {/* Speaking ring */}
      {isSpeaking && <div className="speaking-ring" />}

      {/* "Presenting" badge — this is the current main/full-width tile */}
      {isPrimary && (
        <span className="tile-primary-badge">Presenting</span>
      )}

      {participant?.handRaised && !isScreenShare && (
        <span className="tile-hand-badge">Hand raised</span>
      )}

      {/* "Set as Main" control — shown on non-primary screen shares so the
          user can promote any active share to the full-width main view */}
      {showPrimaryButton && (
        <button
          type="button"
          className="tile-pin-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSetPrimary?.();
          }}
          title="Show this screen share as the main view"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          Set as Main
        </button>
      )}

      {/* Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={{ opacity: participant?.isVideoOff && !isScreenShare ? 0 : 1 }}
      />

      {/* Avatar fallback when video is off */}
      {participant?.isVideoOff && !isScreenShare && (
        <div className="avatar-fallback">
          <span>{initials}</span>
        </div>
      )}

      {/* Name label */}
      <div className="tile-label">
        <span className="tile-name">
          {participant?.name || 'Participant'}
          {isLocal && ' (You)'}
          {participant?.isHost && (
            <span className="host-badge">HOST</span>
          )}
        </span>
        <div className="tile-icons">
          {participant?.isMuted && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
          {participant?.isVideoOff && !isScreenShare && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M15 10.58L22 7v10" />
              <path d="M2.29 2.29A2 2 0 0 0 2 4v12a2 2 0 0 0 2 2h14c.31 0 .61-.07.88-.2" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
