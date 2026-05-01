export function ParticipantsPanel({ participants, isHost, onMuteUser, onRemoveUser, localSocketId }) {
  return (
    <div className="side-panel participants-panel">
      <div className="panel-header">
        <h2>Participants</h2>
        <span className="count-badge">{participants.length}</span>
      </div>
      <ul className="participants-list">
        {participants.map((p) => (
          <li key={p.socketId} className="participant-item">
            <div className="participant-avatar">
              {(p.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="participant-info">
              <span className="participant-name">
                {p.name}
                {p.socketId === localSocketId && ' (You)'}
              </span>
              <div className="participant-badges">
                {p.isHost && <span className="badge-host">Host</span>}
                {p.isMuted && <span className="badge-muted">Muted</span>}
                {p.isVideoOff && <span className="badge-video">No Video</span>}
              </div>
            </div>
            {isHost && p.socketId !== localSocketId && (
              <div className="host-actions">
                <button
                  className="action-btn"
                  onClick={() => onMuteUser(p.socketId)}
                  title="Mute"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  </svg>
                </button>
                <button
                  className="action-btn danger"
                  onClick={() => onRemoveUser(p.socketId)}
                  title="Remove"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
