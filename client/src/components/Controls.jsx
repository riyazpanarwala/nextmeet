import { useState } from 'react';
import { PanelCloseButton } from './PanelCloseButton';

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

const HandIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-4 0v4" />
    <path d="M14 10V4a2 2 0 0 0-4 0v8" />
    <path d="M10 12V6a2 2 0 0 0-4 0v8" />
    <path d="M6 14v-2a2 2 0 0 0-4 0v3a7 7 0 0 0 7 7h4a7 7 0 0 0 7-7v-4a2 2 0 0 0-4 0" />
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

// "More" — grid icon representing the meeting-controls (raise hand, record,
// chat, people, mute all) panel, distinct from the Device Settings gear.
const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export function Controls({
  isMuted, isVideoOff, isScreenSharing, isRecording,
  isHandRaised = false,
  hasAudioTrack = true, hasVideoTrack = true, // false when no mic/camera was ever captured
  canShareScreen, // false when the max concurrent screen-share limit is reached
  onToggleMute, onToggleVideo, onToggleScreen,
  onToggleHand,
  onLeave, onToggleChat, onToggleParticipants, onToggleRecording,
  showChat, showParticipants, showRecording, unreadCount,
  isHost, onMuteAll,
  devices, selectedDevices, onSwitchAudio, onSwitchVideo, onSwitchSpeaker,
}) {
  // Two independent panels: "More" = meeting controls (raise hand, record,
  // chat, people, mute all). "Settings" = device settings (mic/camera/speaker).
  // Opening one closes the other so they never overlap.
  const [showMore, setShowMore] = useState(false);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);

  const handleMoreToggle = () => {
    setShowMore((s) => !s);
    setShowDeviceSettings(false);
  };

  const handleDeviceSettingsToggle = () => {
    setShowDeviceSettings((s) => !s);
    setShowMore(false);
  };

  const closeMore = () => setShowMore(false);
  const closeDeviceSettings = () => setShowDeviceSettings(false);

  const handleDeviceSwitch = async (switchFn, deviceId, label) => {
    try {
      await switchFn(deviceId);
    } catch (err) {
      console.error(`[Controls] Could not switch ${label}:`, err);
      alert(`Could not switch ${label}. Please check the device and try again.`);
    }
  };

  const handleCycleCamera = async () => {
    if (devices.videoIn.length < 2) return;
    const currentIndex = devices.videoIn.findIndex((d) => d.deviceId === selectedDevices.videoIn);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % devices.videoIn.length
      : 0;
    await handleDeviceSwitch(onSwitchVideo, devices.videoIn[nextIndex].deviceId, 'camera');
  };

  // Feature-detect getDisplayMedia — unavailable on iOS Safari (and any
  // WebKit-based iOS browser) and some embedded webviews. Without this,
  // the button looks enabled but silently fails when tapped there.
  const screenShareSupported =
    typeof navigator !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  const screenShareDisabled =
    !isScreenSharing && canShareScreen === false;

  const screenShareTitle = isScreenSharing
    ? 'Stop Sharing'
    : !screenShareSupported
      ? 'Screen sharing is not supported in this browser'
      : canShareScreen === false
        ? 'Screen share limit reached (2 people already sharing)'
        : 'Share Screen';

  const micTitle = !hasAudioTrack
    ? 'No microphone available'
    : isMuted
      ? 'Unmute'
      : 'Mute';

  const camTitle = !hasVideoTrack
    ? 'No camera available'
    : isVideoOff
      ? 'Start Video'
      : 'Stop Video';

  return (
    <>
      <div className="controls-bar">
        <div className="controls-left">
          <span className="room-time">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div className="controls-center">
          {/* Mic — disabled and relabeled when no microphone track was ever captured */}
          <button
            className={`ctrl-btn ${(isMuted || !hasAudioTrack) ? 'active-danger' : ''}`}
            onClick={onToggleMute}
            disabled={!hasAudioTrack}
            title={micTitle}
          >
            <MicIcon muted={isMuted || !hasAudioTrack} />
            <span className="mobile-label">{!hasAudioTrack ? 'No mic' : isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Video — disabled and relabeled when no camera track was ever captured */}
          <button
            className={`ctrl-btn ${(isVideoOff || !hasVideoTrack) ? 'active-danger' : ''}`}
            onClick={onToggleVideo}
            disabled={!hasVideoTrack}
            title={camTitle}
          >
            <CamIcon off={isVideoOff || !hasVideoTrack} />
            <span className="mobile-label">{!hasVideoTrack ? 'No cam' : isVideoOff ? 'Start' : 'Stop'}</span>
          </button>

          {/* Screen Share — disabled when unsupported or the concurrent-share cap is reached */}
          <button
            className={`ctrl-btn ${isScreenSharing ? 'active-green' : ''}`}
            onClick={onToggleScreen}
            disabled={screenShareDisabled}
            title={screenShareTitle}
          >
            <ScreenIcon active={isScreenSharing} />
            <span className="mobile-label">{isScreenSharing ? 'Stop' : 'Share'}</span>
          </button>

          <div className="ctrl-divider" />

          {/* Raise hand — this bar copy is hidden on mobile via .mobile-overflow-action;
            the More-panel copy below is the mobile-only fallback for it. */}
          <button
            className={`ctrl-btn mobile-overflow-action ${isHandRaised ? 'active-hand' : ''}`}
            onClick={onToggleHand}
            title={isHandRaised ? 'Lower hand' : 'Raise hand'}
          >
            <HandIcon />
            <span className="mobile-label">{isHandRaised ? 'Lower' : 'Hand'}</span>
          </button>

          {/* Record */}
          <button
            className={`ctrl-btn mobile-overflow-action ${isRecording ? 'active-rec' : ''} ${showRecording ? 'active' : ''}`}
            onClick={onToggleRecording}
            title="Recording"
          >
            <RecordIcon active={isRecording} />
            {isRecording && <span className="rec-badge-dot" />}
            <span className="mobile-label">Rec</span>
          </button>

          {/* Chat */}
          <button className={`ctrl-btn mobile-overflow-action ${showChat ? 'active' : ''}`} onClick={onToggleChat} title="Chat">
            <ChatIcon />
            {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
            <span className="mobile-label">Chat</span>
          </button>

          {/* Participants */}
          <button className={`ctrl-btn mobile-overflow-action ${showParticipants ? 'active' : ''}`} onClick={onToggleParticipants} title="Participants">
            <ParticipantsIcon />
            <span className="mobile-label">People</span>
          </button>

          {/* More — only meaningful once some of the bar buttons above collapse
            out of view (tablet/mobile). Hidden entirely on desktop via CSS
            (.more-btn), since every action it holds is already visible in
            the bar there — showing it too was the duplicate-icon bug. */}
          <button className={`ctrl-btn more-btn ${showMore ? 'active' : ''}`} onClick={handleMoreToggle} title="More">
            <MoreIcon />
            <span className="mobile-label">More</span>
          </button>

          {/* Settings — device settings: microphone, camera, speaker */}
          <button className={`ctrl-btn ${showDeviceSettings ? 'active' : ''}`} onClick={handleDeviceSettingsToggle} title="Settings">
            <SettingsIcon />
            <span className="mobile-label">Settings</span>
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
      </div>

      {/* Both panels live outside the scrollable controls bar so mobile browsers do not clip them. */}

      {/* "More" panel — each quick action below only becomes visible (via CSS
        mirror-* classes) once its equivalent bar button has actually been
        hidden at that breakpoint, so nothing is ever shown twice. */}
      {showMore && (
        <div className="settings-panel">
          <div className="settings-panel-header">
            <h3>Meeting Controls</h3>
            <PanelCloseButton onClose={closeMore} label="Close" />
          </div>
          <div className="settings-quick-actions">
            {/* Raise hand doesn't open an overlay panel — no need to close More */}
            <button
              type="button"
              className={`settings-quick-btn mirror-hand ${isHandRaised ? 'active-hand' : ''}`}
              onClick={onToggleHand}
            >
              <HandIcon />
              <span>{isHandRaised ? 'Lower hand' : 'Raise hand'}</span>
            </button>

            {/* Record opens the Recording side panel — close More so they don't stack */}
            <button
              type="button"
              className={`settings-quick-btn mirror-rec ${isRecording || showRecording ? 'active-rec' : ''}`}
              onClick={() => {
                onToggleRecording();
                closeMore();
              }}
            >
              <RecordIcon active={isRecording} />
              <span>{isRecording ? 'Recording' : 'Record'}</span>
            </button>

            {/* Chat opens the Chat side panel (which has its own close icon) — close More */}
            <button
              type="button"
              className={`settings-quick-btn mirror-chat ${showChat ? 'active' : ''}`}
              onClick={() => {
                onToggleChat();
                closeMore();
              }}
            >
              <ChatIcon />
              <span>Chat{unreadCount > 0 ? ` (${unreadCount})` : ''}</span>
            </button>

            {/* Participants opens the Participants side panel — close More */}
            <button
              type="button"
              className={`settings-quick-btn mirror-people ${showParticipants ? 'active' : ''}`}
              onClick={() => {
                onToggleParticipants();
                closeMore();
              }}
            >
              <ParticipantsIcon />
              <span>People</span>
            </button>

            {/* Mute All is a fire-and-forget action, not a panel — no need to close More */}
            {isHost && (
              <button
                type="button"
                className="settings-quick-btn mirror-muteall"
                onClick={onMuteAll}
              >
                <MicIcon muted />
                <span>Mute all</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* "Settings" panel — device settings */}
      {showDeviceSettings && (
        <div className="settings-panel">
          <div className="settings-panel-header">
            <h3>Device Settings</h3>
            <PanelCloseButton onClose={closeDeviceSettings} label="Close" />
          </div>

          <label>Microphone</label>
          <select
            value={selectedDevices.audioIn}
            onChange={(e) => handleDeviceSwitch(onSwitchAudio, e.target.value, 'microphone')}
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
            onChange={(e) => handleDeviceSwitch(onSwitchVideo, e.target.value, 'camera')}
          >
            {devices.videoIn.length === 0 && <option>No camera found</option>}
            {devices.videoIn.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
          {devices.videoIn.length > 1 && (
            <button
              type="button"
              className="settings-action-btn"
              onClick={handleCycleCamera}
            >
              Switch Camera
            </button>
          )}

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
    </>
  );
}