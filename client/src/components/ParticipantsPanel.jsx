import { PanelCloseButton } from './PanelCloseButton';

export function ParticipantsPanel({
  participants,
  waitingRequests = [],
  isHost,
  canModerate,
  onMuteUser,
  onRemoveUser,
  onSetCoHost,
  onWaitingResponse,
  localSocketId,
  onClose,
}) {
  return (
    <div className="side-panel participants-panel">
      <div className="panel-header">
        <h2>Participants</h2>
        <span className="count-badge">{participants.length}</span>
        <PanelCloseButton onClose={onClose} label="Close participants" />
      </div>

      {canModerate && waitingRequests.length > 0 && (
        <div className="waiting-room-section">
          <div className="waiting-room-title">
            <h3>Waiting room</h3>
            <span>{waitingRequests.length}</span>
          </div>
          <div className="waiting-room-list">
            {waitingRequests.map((request) => (
              <div key={request.socketId} className="waiting-request">
                <div className="waiting-request-info">
                  <span className="waiting-avatar">
                    {(request.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span>{request.name || 'Guest'}</span>
                </div>
                <div className="waiting-actions">
                  <button type="button" onClick={() => onWaitingResponse(request.socketId, true)}>
                    Admit
                  </button>
                  <button type="button" className="danger" onClick={() => onWaitingResponse(request.socketId, false)}>
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                {!p.isHost && p.isCoHost && <span className="badge-cohost">Co-host</span>}
                {p.handRaised && <span className="badge-hand">Hand raised</span>}
                {p.isMuted && <span className="badge-muted">Muted</span>}
                {p.isVideoOff && <span className="badge-video">No Video</span>}
              </div>
            </div>
            {canModerate && p.socketId !== localSocketId && !p.isHost && (
              <div className="host-actions">
                {isHost && (
                  <button
                    className={`action-btn role ${p.isCoHost ? 'active' : ''}`}
                    onClick={() => onSetCoHost(p.socketId, !p.isCoHost)}
                    title={p.isCoHost ? 'Remove co-host' : 'Make co-host'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l3 6 6 .9-4.5 4.4 1.1 6.2L12 16.5l-5.6 3 1.1-6.2L3 8.9 9 8z" />
                    </svg>
                  </button>
                )}
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
