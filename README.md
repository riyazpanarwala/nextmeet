# NexMeet - WebRTC Video Conferencing

NexMeet is a browser-based video meeting app built with React, Vite, Node.js, Express, Socket.IO, and native WebRTC. It supports small mesh calls with up to 6 participants per room, real-time chat, host controls, local composite recording, device switching, and up to 2 concurrent screen shares.

The media path is peer-to-peer. The Node server only handles signaling, room state, chat relay, host actions, and screen-share slot limits.

## Features

### Meetings
- Up to 6 participants per room using WebRTC mesh peer connections.
- Lobby with camera preview, generated room IDs, join-existing-room flow, copy room ID, and pre-join mic/camera toggles.
- Responsive video grid with participant labels, host badges, muted/camera-off indicators, avatar fallback, and active-speaker highlighting.
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

### Recording
- Local-only recording through `MediaRecorder`.
- A canvas compositor records camera tiles and active screen shares into a single layout.
- Audio from all available participant streams is mixed with the Web Audio API.
- Recording preview, file size display, discard, and WebM/MP4-capable download naming.
- Nothing is uploaded to the server.

### Collaboration
- Real-time room chat with unread count.
- Participants panel with media status.
- Host-only mute-all and remove-participant controls.
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
        |-- hooks/
        |   |-- useSocket.js
        |   |-- useMediaDevices.js
        |   |-- usePeerConnections.js
        |   |-- useAudioLevel.js
        |   `-- useRecording.js
        `-- components/
            |-- Lobby.jsx
            |-- Room.jsx
            |-- VideoTile.jsx
            |-- Controls.jsx
            |-- ChatPanel.jsx
            |-- ParticipantsPanel.jsx
            `-- RecordingPanel.jsx
```

## Quick Start

### Prerequisites

- Node.js 18 or newer.
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
| `join-room` | `{ roomId, userName, isMuted, isVideoOff }` | Join or create a room |
| `offer` | `{ to, offer, kind }` | Forward SDP offer; `kind` is `camera` or `screen` |
| `answer` | `{ to, answer, kind }` | Forward SDP answer |
| `ice-candidate` | `{ to, candidate, kind }` | Forward ICE candidate |
| `media-state` | `{ roomId, isMuted, isVideoOff }` | Broadcast mute/video state |
| `screen-share-started` | `{ roomId }`, ack `{ ok, max? }` | Reserve a screen-share slot |
| `screen-share-stopped` | `{ roomId }` | Release local screen-share slot |
| `chat-message` | `{ roomId, message }` | Send chat message |
| `mute-all` | `{ roomId }` | Host action: mute all other clients locally |
| `remove-user` | `{ roomId, targetSocketId }` | Host action: remove a participant |

### Server to Client

| Event | Payload | Description |
| --- | --- | --- |
| `room-joined` | `{ socketId, isHost, participants, screenSharingSocketIds }` | Join confirmation and existing room state |
| `user-joined` | `{ socketId, name, isHost, isMuted, isVideoOff }` | New participant joined |
| `user-left` | `{ socketId }` | Participant left |
| `room-full` | `{ max }` | Room capacity reached |
| `offer` | `{ from, offer, kind }` | Incoming SDP offer |
| `answer` | `{ from, answer, kind }` | Incoming SDP answer |
| `ice-candidate` | `{ from, candidate, kind }` | Incoming ICE candidate |
| `peer-media-state` | `{ socketId, isMuted, isVideoOff }` | Peer media state changed |
| `peer-screen-share` | `{ socketId, sharing }` | Peer started/stopped screen sharing |
| `chat-message` | `{ id, from, name, message, timestamp }` | Incoming chat message |
| `host-mute-all` | none | Host requested all peers mute |
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

| Browser | Video/Audio | Screen Share | Speaker Select | Recording |
| --- | --- | --- | --- | --- |
| Chrome 90+ | yes | yes | yes | yes |
| Edge 90+ | yes | yes | yes | yes |
| Firefox 90+ | yes | yes | no `setSinkId` | yes |
| Safari 15.4+ on macOS | yes | yes | no `setSinkId` | yes |
| Chrome on Android | yes | no `getDisplayMedia` | no `setSinkId` | yes |
| Safari on iOS | yes | no `getDisplayMedia` | no `setSinkId` | yes |

Notes:

- Camera and microphone access require HTTPS in production. `localhost` is exempt.
- Screen sharing depends on `navigator.mediaDevices.getDisplayMedia`.
- The Share Screen control is disabled when `getDisplayMedia` is unavailable, which covers iOS browsers and many mobile browsers.
- Speaker selection depends on `HTMLMediaElement.setSinkId`, currently strongest in Chromium-based desktop browsers.
- Recording support depends on `MediaRecorder` and the browser's supported MIME types. NexMeet tries WebM first and falls back to other supported types when available.

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
| Browser stop-sharing button | Shared track `onended` runs the same cleanup path |
| Host leaves | Server transfers host to the next participant |
| User leaves | Camera and screen-share PCs are closed |

## License

No open-source license is currently specified. This project is marked private in `package.json`.
