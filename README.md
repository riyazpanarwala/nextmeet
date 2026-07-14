# NexMeet - WebRTC Video Conferencing

NexMeet is a browser-based video meeting app built with React, Vite, Node.js, Express, Socket.IO, and native WebRTC. It supports small mesh calls with up to 6 participants per room, room passwords and locking, live captions, rich chat, a shared whiteboard, local composite recording, screen-share annotations, and up to 2 concurrent screen shares.

The media path is peer-to-peer. The Node server handles signaling and transient room state, including security, chat and caption relay, whiteboard and annotation state, host actions, the shared meeting timer, and screen-share slot limits. It never receives camera, microphone, or screen-share media.

## Features

### Meetings

- Up to 6 participants per room using WebRTC mesh peer connections.
- Lobby with camera preview, generated room IDs, join-existing-room flow, copy room ID, and pre-join mic/camera toggles.
- Shared invite links through the `?room=ROOMID` URL parameter.
- Responsive video grid with participant labels, host badges, muted/camera-off indicators, avatar fallback, and active-speaker highlighting.
- Optional room password set by the creator, plus host-controlled room lock/unlock.
- Server-anchored meeting timer that stays consistent for current participants and late joiners.
- Pin/spotlight a participant or open a participant in a floating in-app PiP tile.
- Per-participant connection-quality badges sampled from WebRTC statistics.
- Light and dark themes, optional join/leave sounds, and keyboard shortcuts for common meeting actions.
- Room-full handling for the 7th joiner.

### Media Controls

- Mute/unmute microphone.
- Start/stop camera, with disabled controls when no usable device exists.
- Switch microphone, camera, and speaker output during the call.
- Device hot-plug updates through `navigator.mediaDevices.devicechange`.
- Audio-only or video-only fallback when one device type is unavailable.

### Screen Sharing

- Up to 2 participants can share simultaneously.
- Each screen share uses dedicated `RTCPeerConnection` instances instead of replacing the camera track.
- Screen-share connections are direction-aware: outgoing screen PCs send the local screen to each viewer, and incoming screen PCs receive another participant's share.
- Camera tiles stay live while screen sharing.
- Late joiners receive existing `screenSharingSocketIds`, then active sharers create fresh screen offers for them.
- Users can view two active shares side by side or promote one share as the main presentation.
- The server rejects a 3rd concurrent screen share with an acknowledgment response.

### Screen Annotations

- Draw on screen-share tiles with pen, highlighter, line, arrow, rectangle, circle, and text tools.
- Annotation coordinates are stored relative to the actual letterboxed video content, so marks stay aligned across different layouts and window sizes.
- Viewers can request drawing access on another participant's screen share.
- Screen owners can approve, deny, or revoke annotation access while sharing.
- Export the current annotation layer as PNG or PDF.
- The server keeps up to 300 shapes per active screen-share session so late joiners receive the current overlay. History is cleared when that share stops or restarts and is never persisted.

### Live Captions

- Local speech recognition through the browser Web Speech API; no audio is sent to the NexMeet server.
- Interim and final transcript text is relayed to the room and labeled by speaker.
- Displays the 3 most recently active speakers and removes inactive lines after 6 seconds.
- Select from 27 curated BCP-47 recognition locales, including English variants, major European and Asian languages, and 6 Indian languages; the preference is saved locally.
- Captions transcribe each speaker in their selected language; they do not translate speech.

### Recording

- Local-only recording through `MediaRecorder`.
- A canvas compositor records camera tiles and active screen shares into a single layout.
- Audio from all available participant streams is mixed with the Web Audio API.
- Recording preview, file size display, discard, and WebM/MP4-capable download naming.
- Nothing is uploaded to the server.

### Collaboration

- Real-time room chat with unread count, replies, Like/Love/Laugh reactions, and file attachments up to 5 MB.
- Shared whiteboard with the same drawing and text tools, synchronized open/close state, undo, clear, and PNG/PDF export.
- Whiteboard state is held in server memory for the room lifetime, so late joiners see the current board.
- Participants panel with media status.
- Raise/lower hand with header counts, participant badges, and tile badges.
- Host-only mute-all, mute-participant, and remove-participant controls.
- Automatic host transfer when the host leaves.

### Reliability

- Separate ICE candidate queues for camera connections and screen-share connections.
- ICE restart on failed camera or screen-share connections.
- Socket.IO reconnect attempts with a reconnecting banner.
- Cleanup of camera PCs, outgoing screen PCs, incoming screen PCs, local media, and recording state on leave.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19.2.5 |
| Build tool | Vite 8.0.10 |
| Styling | Vanilla CSS |
| Signaling | Socket.IO 4.8.3 |
| Server | Node.js, Express 5.2.1 |
| Media | Native WebRTC |
| Recording | MediaRecorder, Canvas, Web Audio API |
| Captions | Browser Web Speech API (`SpeechRecognition`) |
| Drawing | SVG overlays for screen annotations and the shared whiteboard |

## Project Structure

```text
nexmeet/
|-- package.json                  # root scripts for server/client
|-- README.md
|-- ARCHITECTURE.md               # deeper implementation guide
|-- server/
|   |-- package.json
|   `-- server.js                 # Express + Socket.IO signaling server
`-- client/
    |-- .env.example              # VITE_SOCKET_URL reference
    |-- package.json
    |-- vite.config.js
    |-- index.html
    `-- src/
        |-- main.jsx
        |-- App.jsx               # app phases: lobby, connecting, room, error
        |-- App.css
        |-- annotations.css
        |-- captions.css
        |-- hooks/
        |   |-- useSocket.js
        |   |-- useMediaDevices.js
        |   |-- usePeerConnections.js
        |   |-- useAudioLevel.js
        |   |-- useAnnotations.js
        |   |-- useRecording.js
        |   |-- useWhiteboard.js
        |   |-- useCaptions.js
        |   |-- useConnectionQuality.js
        |   |-- useMeetingTimer.js
        |   `-- useTheme.js
        |-- utils/
        |   |-- annotationExport.js
        |   `-- captionLanguages.js
        `-- components/
            |-- Lobby.jsx
            |-- Room.jsx
            |-- VideoTile.jsx
            |-- Controls.jsx
            |-- ChatPanel.jsx
            |-- ParticipantsPanel.jsx
            |-- RecordingPanel.jsx
            |-- AnnotationOverlay.jsx
            |-- AnnotationToolbar.jsx
            |-- WhiteboardPanel.jsx
            |-- CaptionsOverlay.jsx
            |-- KeyboardShortcutsModal.jsx
            |-- ThemeToggle.jsx
            `-- PanelCloseButton.jsx
```

## Quick Start

### Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite 8).
- A WebRTC-capable browser such as Chrome, Edge, Firefox, or Safari 15.4+.
- Camera and microphone recommended. The app can still join with only one usable media device.

### Install

```bash
npm install
npm run install:all
```

### Configure

For local development, the client defaults to a signaling server on the same hostname at port `3001`. You can also copy the example env file:

```bash
cp client/.env.example client/.env
```

Set `VITE_SOCKET_URL` in `client/.env` when the signaling server is on a different host:

```env
VITE_SOCKET_URL=http://localhost:3001
```

### Run

```bash
npm run dev
```

This starts:

- Signaling server: `http://localhost:3001`
- Vite client: `http://localhost:5173`

Open `http://localhost:5173` in two browser windows, enter names, use the same room ID, and join.

### Individual Processes

```bash
npm run dev:server
npm run dev:client
```

## Environment Variables

### Client

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_SOCKET_URL` | current page protocol/hostname with port `3001` | Socket.IO signaling server URL |

### Server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP and Socket.IO server port |

## Scripts

```bash
# project root
npm run install:all      # install server and client dependencies
npm run dev              # start server and client together
npm run dev:server       # start server only
npm run dev:client       # start client only
npm run build            # build client
npm start                # start production server

# client
npm run dev
npm run build
npm run preview

# server
npm run dev
npm start
```

## Keyboard Shortcuts

Shortcuts are ignored while focus is in a text field.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `M` | Toggle mute | `V` | Toggle camera |
| `S` | Toggle screen share | `H` | Raise/lower hand |
| `C` | Toggle chat | `P` | Toggle participants |
| `R` | Toggle recording panel | `W` | Toggle whiteboard |
| `L` | Toggle live captions | `?` | Show shortcut help |
| `Esc` | Close open panels | | |

## WebRTC Flow

When Bob joins a room where Alice is already present:

1. Bob emits `join-room`.
2. The server emits `room-joined` to Bob with Alice in `participants`.
3. Bob creates a camera/mic `RTCPeerConnection` for Alice, adds local tracks, creates an offer, and sends `offer` with `kind: "camera"`.
4. Alice creates her camera/mic `RTCPeerConnection`, sets Bob's offer, creates an answer, and sends `answer` with `kind: "camera"`.
5. Both peers exchange `ice-candidate` events tagged with `kind: "camera"`.
6. Remote audio/video tracks are merged into a persistent `MediaStream` per peer and rendered in `VideoTile`.

Screen shares use the same signaling events, but every payload is tagged with `kind: "screen"` and routed to the screen-share PC maps.

## Screen Sharing Model

NexMeet does not swap the camera track for screen video. Instead:

- The sharer captures `getDisplayMedia({ video, audio: true })`.
- The server reserves a screen-share slot through `screen-share-started`.
- For each viewer, the sharer creates an outgoing screen `RTCPeerConnection`.
- Each viewer creates a separate incoming screen `RTCPeerConnection`.
- ICE candidates, answers, and cleanup are routed independently from camera PCs.

This lets two participants share at the same time and keeps their camera streams active.

## Socket Events

### Client to Server

| Event | Payload | Description |
| --- | --- | --- |
| `join-room` | `{ roomId, userName, isMuted, isVideoOff, password, createPassword }` | Join or create a room; the first joiner may set a password |
| `offer` | `{ to, offer, kind }` | Forward SDP offer; `kind` is `camera` or `screen` |
| `answer` | `{ to, answer, kind }` | Forward SDP answer |
| `ice-candidate` | `{ to, candidate, kind }` | Forward ICE candidate |
| `media-state` | `{ roomId, isMuted, isVideoOff }` | Broadcast mute/video state |
| `hand-state` | `{ roomId, raised }` | Broadcast raised-hand state |
| `screen-share-started` | `{ roomId }`, ack `{ ok, max? }` | Reserve a screen-share slot |
| `screen-share-stopped` | `{ roomId }` | Release local screen-share slot |
| `room-lock-set` | `{ roomId, locked }`, ack `{ ok, locked? }` | Host locks or unlocks admission |
| `annotation-request-access` | `{ roomId, screenOwnerId }`, ack `{ ok }` | Ask a presenter for drawing access |
| `annotation-access-response` | `{ roomId, requesterSocketId, approved }`, ack `{ ok }` | Presenter approves or denies access |
| `annotation-access-revoke` | `{ roomId, screenOwnerId, targetSocketId }`, ack `{ ok }` | Presenter revokes drawing access |
| `annotation-draw` | `{ roomId, screenOwnerId, shape }` | Relay a completed annotation shape |
| `annotation-undo` | `{ roomId, screenOwnerId, shapeId }` | Relay undo for one annotation shape |
| `annotation-clear` | `{ roomId, screenOwnerId }` | Relay clear for one screen's annotations |
| `whiteboard-open-set` | `{ roomId, open }` | Synchronize whether the shared whiteboard is open |
| `whiteboard-draw` | `{ roomId, shape }` | Add a shared whiteboard shape |
| `whiteboard-undo` | `{ roomId, shapeId }` | Remove a whiteboard shape |
| `whiteboard-clear` | `{ roomId }` | Clear the shared whiteboard |
| `chat-message` | `{ roomId, message, file?, replyTo? }` | Send text, an optional attachment, and reply metadata |
| `chat-reaction` | `{ roomId, messageId, reaction }` | Relay a `Like`, `Love`, or `Laugh` reaction |
| `caption-text` | `{ roomId, text, isFinal }` | Relay locally recognized interim or final transcript text |
| `mute-all` | `{ roomId }` | Host action: mute all other clients locally |
| `mute-user` | `{ roomId, targetSocketId }` | Host action: mute one participant locally |
| `remove-user` | `{ roomId, targetSocketId }` | Host action: remove a participant |

### Server to Client

| Event | Payload | Description |
| --- | --- | --- |
| `room-joined` | `{ socketId, isHost, participants, screenSharingSocketIds, roomLocked, passwordProtected, whiteboard, roomCreatedAt, annotationHistory }` | Join confirmation and transient room state |
| `user-joined` | `{ socketId, name, isHost, isMuted, isVideoOff, handRaised }` | New participant joined |
| `user-left` | `{ socketId }` | Participant left |
| `room-full` | `{ max }` | Room capacity reached |
| `room-locked` | none | Join rejected because the host locked the room |
| `room-password-required` | `{ invalid }` | Join rejected because a password is missing or invalid |
| `offer` | `{ from, offer, kind }` | Incoming SDP offer |
| `answer` | `{ from, answer, kind }` | Incoming SDP answer |
| `ice-candidate` | `{ from, candidate, kind }` | Incoming ICE candidate |
| `peer-media-state` | `{ socketId, isMuted, isVideoOff }` | Peer media state changed |
| `peer-hand-state` | `{ socketId, raised }` | Peer raised/lowered hand |
| `peer-screen-share` | `{ socketId, sharing }` | Peer started/stopped screen sharing |
| `annotation-access-requested` | `{ screenOwnerId, requesterSocketId, requesterName }` | Presenter receives a draw-access request |
| `annotation-access-updated` | `{ screenOwnerId, granted }` | Requester receives access status |
| `annotation-access-grant-updated` | `{ screenOwnerId, socketId, name?, granted }` | Presenter receives grant list update |
| `annotation-access-revoked` | `{ screenOwnerId, socketId }` | Presenter receives revoke confirmation |
| `annotation-draw` | `{ screenOwnerId, shape }` | Incoming annotation shape |
| `annotation-undo` | `{ screenOwnerId, shapeId }` | Incoming annotation undo |
| `annotation-clear` | `{ screenOwnerId }` | Incoming annotation clear |
| `room-lock-updated` | `{ locked }` | Room lock state changed |
| `whiteboard-open-updated` | `{ open }` | Shared whiteboard visibility changed |
| `whiteboard-draw` | `{ shape }` | Incoming whiteboard shape |
| `whiteboard-undo` | `{ shapeId }` | Incoming whiteboard undo |
| `whiteboard-clear` | none | Clear the local whiteboard state |
| `chat-message` | `{ id, from, name, message, file, replyTo, reactions, timestamp }` | Incoming rich chat message |
| `chat-reaction` | `{ messageId, reaction, socketId, name }` | Incoming message reaction |
| `caption-text` | `{ socketId, name, text, isFinal }` | Incoming speaker caption |
| `host-mute-all` | none | Host requested all peers mute |
| `host-mute-user` | none | Host requested current user mute |
| `host-transferred` | `{ socketId }` | New host assigned |
| `removed-from-room` | none | Current user was removed by host |

## REST Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /health` | Returns `{ status: "ok" }` |
| `GET /room/:roomId/info` | Returns room existence, participant count, active screen-share count, and max screen shares |

## STUN and TURN

The client currently ships with public STUN servers in `client/src/hooks/usePeerConnections.js`:

```js
{ urls: 'stun:stun.l.google.com:19302' },
{ urls: 'stun:stun1.l.google.com:19302' },
{ urls: 'stun:stun.cloudflare.com:3478' },
```

Camera senders are capped at about 2 Mbps and 30 fps. Screen-share senders are capped at about 6 Mbps and 30 fps with a maintain-resolution degradation preference.

For production reliability, add TURN credentials to the same `ICE_SERVERS` array:

```js
{
  urls: 'turn:your-turn-server.com:3478',
  username: 'your-username',
  credential: 'your-credential',
}
```

TURN is needed for users behind restrictive corporate networks, symmetric NATs, or some mobile carrier networks.

### Managed TURN Options

| Provider | Notes |
| --- | --- |
| [Cloudflare TURN](https://developers.cloudflare.com/calls/turn/) | Global edge TURN service |
| [Metered.ca](https://www.metered.ca/stun-turn) | Free tier available |
| [Twilio Network Traversal](https://www.twilio.com/docs/stun-turn) | Pay-per-use STUN/TURN credentials |
| Self-hosted coturn | Lowest software cost, requires a VPS and operations work |

### Self-host coturn on Ubuntu

Install coturn:

```bash
sudo apt update
sudo apt install coturn
```

Edit `/etc/turnserver.conf`:

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=nexmeet:replace-with-a-strong-secret
realm=your-domain.com
log-file=/var/log/coturn/turn.log
```

Enable and start the service:

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

Open firewall ports:

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp
```

Then add the TURN server to `ICE_SERVERS`:

```js
{
  urls: [
    'turn:turn.your-domain.com:3478',
    'turns:turn.your-domain.com:5349',
  ],
  username: 'nexmeet',
  credential: 'replace-with-a-strong-secret',
}
```

## Production Deployment

1. Set `VITE_SOCKET_URL` to your production signaling origin before building the client.
2. Build the client.

```bash
npm run build
```

3. Serve `client/dist` from static hosting or a reverse proxy.
4. Run `server/server.js` behind HTTPS-capable infrastructure with WebSocket upgrade support.

Example server command:

```bash
NODE_ENV=production PORT=3001 node server/server.js
```

HTTPS is required for camera, microphone, and screen capture in production. `localhost` is the browser exception.

### Host the Signaling Server with PM2

On the server host:

```bash
npm install --prefix server --omit=dev
npm install -g pm2
PORT=3001 NODE_ENV=production pm2 start server/server.js --name nexmeet-signal
pm2 save
pm2 startup
```

If the server and static client are deployed on different domains, set `VITE_SOCKET_URL` before building the client:

```bash
echo "VITE_SOCKET_URL=https://api.your-domain.com" > client/.env
npm run build
```

### Nginx Reverse Proxy

This example serves the built React app from `client/dist` and proxies Socket.IO traffic to the Node signaling server on port `3001`.

```nginx
server {
  listen 443 ssl http2;
  server_name meet.your-domain.com;

  ssl_certificate     /etc/letsencrypt/live/meet.your-domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/meet.your-domain.com/privkey.pem;

  root /var/www/nexmeet/client/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

If the signaling server lives on a separate API domain, use the same `/socket.io/` proxy block there and point `VITE_SOCKET_URL` at that domain.

## Browser Support

| Browser | Video/Audio | Screen Share | Speaker Select | Recording | Live Captions |
| --- | --- | --- | --- | --- | --- |
| Chrome 90+ | yes | yes | yes | yes | feature-detected |
| Edge 90+ | yes | yes | yes | yes | feature-detected |
| Firefox 90+ | yes | yes | no `setSinkId` | yes | feature-detected |
| Safari 15.4+ on macOS | yes | yes | no `setSinkId` | yes | feature-detected |
| Chrome on Android | yes | no `getDisplayMedia` | no `setSinkId` | yes | feature-detected |
| Safari on iOS | yes | no `getDisplayMedia` | no `setSinkId` | yes | feature-detected |

Notes:

- Camera and microphone access require HTTPS in production. `localhost` is exempt.
- Screen sharing depends on `navigator.mediaDevices.getDisplayMedia`.
- The Share Screen control is disabled when `getDisplayMedia` is unavailable, which covers iOS browsers and many mobile browsers.
- Speaker selection depends on `HTMLMediaElement.setSinkId`, currently strongest in Chromium-based desktop browsers.
- Recording support depends on `MediaRecorder` and the browser's supported MIME types. NexMeet tries WebM first and falls back to other supported types when available.
- Live captions require `window.SpeechRecognition` or `window.webkitSpeechRecognition`. The caption controls are hidden when neither API exists, and actual language availability is browser/platform dependent.

## Scaling Notes

NexMeet uses a mesh topology. Every participant connects directly to every other participant, so upload and CPU load grow quickly as the room fills.

| Participants | Camera upload streams per participant | Recommendation |
| --- | --- | --- |
| 2 | 1 | Mesh is fine |
| 4 | 3 | Mesh is usually fine |
| 6 | 5 | Current upper limit |
| 10+ | 9+ | Use an SFU |

For larger rooms, migrate media to an SFU such as LiveKit, mediasoup, or Janus. Socket.IO can still remain useful for chat and room-level product events.

## Known Edge Cases

| Scenario | Handling |
| --- | --- |
| Camera/mic permission denied | Error phase with a clear message |
| Camera missing but mic works | Join audio-only |
| Mic missing but camera works | Join video-only |
| Room is full | `room-full` overlay |
| ICE candidate arrives early | Candidate is queued until remote description is set |
| Camera or screen ICE failure | `pc.restartIce()` and renegotiation path |
| 3rd concurrent screen share | Server ack rejects and the client stops local capture |
| Viewer wants to draw on a share | Presenter approval is required before annotation events are accepted |
| Screen share ends | Annotation access and shapes for that screen are cleared |
| User joins during an annotated share | `room-joined.annotationHistory` restores up to the latest 300 shapes for each active share |
| Browser stop-sharing button | Shared track `onended` runs the same cleanup path |
| Missing/invalid room password | Join is rejected with a password error and a Back to Lobby action |
| Host locks the room | New joins are rejected until the host unlocks it |
| Chat attachment exceeds 5 MB | Client rejects it; the server also validates the size |
| Web Speech API unavailable | Caption controls are hidden |
| Speech recognition ends after silence | The client restarts recognition while captions remain enabled |
| Host leaves | Server transfers host to the next participant |
| User leaves | Camera and screen-share PCs are closed |

## License

No open-source license is currently specified. This project is marked private in `package.json`.
