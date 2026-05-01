import { useState } from 'react';

const MicIcon = ({ muted }) =>
  muted ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );

const CamIcon = ({ off }) =>
  off ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" /><path d="M15 10.58L22 7v10" />
      <path d="M2.29 2.29A2 2 0 0 0 2 4v12a2 2 0 0 0 2 2h14c.31 0 .61-.07.88-.2" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );

const ScreenIcon = ({ active }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const RecordIcon = ({ active }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="4" fill={active ? '#ef4444' : 'currentColor'} stroke="none" />
  </svg>
);

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ParticipantsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const LeaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export function Controls({
  isMuted, isVideoOff, isScreenSharing, isRecording,
  onToggleMute, onToggleVideo, onToggleScreen,
  onLeave, onToggleChat, onToggleParticipants, onToggleRecording,
  showChat, showParticipants, showRecording, unreadCount,
  isHost, onMuteAll,
  devices, selectedDevices, onSwitchAudio, onSwitchVideo, onSwitchSpeaker,
}) {
  const [showSettings, setShowSettings] = useState(false);

  const handleSettingsToggle = () => {
    setShowSettings((s) => !s);
  };

  return (
    <div className="controls-bar">
      <div className="controls-left">
        <span className="room-time">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="controls-center">
        {/* Mute */}
        <button className={`ctrl-btn ${isMuted ? 'active-danger' : ''}`} onClick={onToggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
          <MicIcon muted={isMuted} />
          <span className="mobile-label">{isMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        {/* Video */}
        <button className={`ctrl-btn ${isVideoOff ? 'active-danger' : ''}`} onClick={onToggleVideo} title={isVideoOff ? 'Start Video' : 'Stop Video'}>
          <CamIcon off={isVideoOff} />
          <span className="mobile-label">{isVideoOff ? 'Start' : 'Stop'}</span>
        </button>

        {/* Screen Share */}
        <button className={`ctrl-btn ${isScreenSharing ? 'active-green' : ''}`} onClick={onToggleScreen} title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}>
          <ScreenIcon active={isScreenSharing} />
          <span className="mobile-label">{isScreenSharing ? 'Stop' : 'Share'}</span>
        </button>

        <div className="ctrl-divider" />

        {/* Record */}
        <button
          className={`ctrl-btn ${isRecording ? 'active-rec' : ''} ${showRecording ? 'active' : ''}`}
          onClick={onToggleRecording}
          title="Recording"
        >
          <RecordIcon active={isRecording} />
          {isRecording && <span className="rec-badge-dot" />}
          <span className="mobile-label">Rec</span>
        </button>

        {/* Chat */}
        <button className={`ctrl-btn ${showChat ? 'active' : ''}`} onClick={onToggleChat} title="Chat">
          <ChatIcon />
          {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
          <span className="mobile-label">Chat</span>
        </button>

        {/* Participants */}
        <button className={`ctrl-btn ${showParticipants ? 'active' : ''}`} onClick={onToggleParticipants} title="Participants">
          <ParticipantsIcon />
          <span className="mobile-label">People</span>
        </button>

        {/* Settings */}
        <button className={`ctrl-btn ${showSettings ? 'active' : ''}`} onClick={handleSettingsToggle} title="Settings">
          <SettingsIcon />
          <span className="mobile-label">More</span>
        </button>

        <div className="ctrl-divider" />

        {/* Leave */}
        <button className="ctrl-btn leave-btn" onClick={onLeave} title="Leave meeting">
          <LeaveIcon />
          <span>Leave</span>
        </button>
      </div>

      <div className="controls-right">
        {isHost && (
          <button className="host-ctrl-btn" onClick={onMuteAll} title="Mute all participants">
            Mute All
          </button>
        )}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="settings-panel">
          <h3>Device Settings</h3>

          <label>Microphone</label>
          <select
            value={selectedDevices.audioIn}
            onChange={(e) => onSwitchAudio(e.target.value)}
          >
            {devices.audioIn.length === 0 && <option>No microphone found</option>}
            {devices.audioIn.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>

          <label>Camera</label>
          <select
            value={selectedDevices.videoIn}
            onChange={(e) => onSwitchVideo(e.target.value)}
          >
            {devices.videoIn.length === 0 && <option>No camera found</option>}
            {devices.videoIn.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>

          <label>Speaker</label>
          <select
            value={selectedDevices.audioOut}
            onChange={(e) => onSwitchSpeaker(e.target.value)}
          >
            {devices.audioOut.length === 0 && <option>Default speaker</option>}
            {devices.audioOut.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
