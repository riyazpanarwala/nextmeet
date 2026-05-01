import { useState, useCallback } from 'react';
import { useSocket } from './hooks/useSocket';
import { useMediaDevices } from './hooks/useMediaDevices';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';
import './App.css';

const PHASE = { LOBBY: 'lobby', CONNECTING: 'connecting', ROOM: 'room', ERROR: 'error' };

export default function App() {
  const [phase, setPhase] = useState(PHASE.LOBBY);
  const [localInfo, setLocalInfo] = useState(null);
  const [error, setError] = useState('');

  const { socket, connected } = useSocket();
  const mediaState = useMediaDevices();

  const handleJoin = useCallback(
    async ({ name, roomId }) => {
      setPhase(PHASE.CONNECTING);

      // Get media FIRST — localStreamRef must be populated before Room mounts
      // so tracks are available when createPeerConnection() is called
      try {
        await mediaState.startLocalStream();
      } catch (err) {
        const msg =
          err.name === 'NotAllowedError'
            ? 'Camera/microphone permission denied. Please allow access and try again.'
            : err.name === 'NotFoundError'
            ? 'No camera or microphone found.'
            : `Media error: ${err.message}`;
        setError(msg);
        setPhase(PHASE.ERROR);
        return;
      }

      if (!socket || !socket.connected) {
        setError('Could not connect to server. Make sure the signaling server is running on port 3001.');
        setPhase(PHASE.ERROR);
        return;
      }

      // Set localInfo → triggers Room to mount → Room registers all socket
      // listeners in its useEffect → THEN emits join-room.
      // This prevents the race where join-room fires before listeners are attached.
      setLocalInfo({ name, roomId });
      setPhase(PHASE.ROOM);
    },
    [socket, mediaState]
  );

  const handleLeave = useCallback(() => {
    setPhase(PHASE.LOBBY);
    setLocalInfo(null);
    setError('');
  }, []);

  // Connection status banner
  const showReconnecting = phase === PHASE.ROOM && !connected;

  return (
    <div className="app">
      {showReconnecting && (
        <div className="reconnect-banner">
          ⚠ Connection lost — reconnecting…
        </div>
      )}

      {phase === PHASE.LOBBY && <Lobby onJoin={handleJoin} />}

      {phase === PHASE.CONNECTING && (
        <div className="loading-screen">
          <div className="spinner" />
          <p>Setting up your meeting…</p>
        </div>
      )}

      {phase === PHASE.ROOM && socket && localInfo && (
        <Room
          socket={socket}
          localInfo={localInfo}
          mediaState={mediaState}
          onLeave={handleLeave}
        />
      )}

      {phase === PHASE.ERROR && (
        <div className="error-screen">
          <div className="error-card">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2>Something went wrong</h2>
            <p>{error}</p>
            <button onClick={() => setPhase(PHASE.LOBBY)}>Try Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
