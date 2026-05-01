# NexMeet — WebRTC Video Conferencing

A production-ready, multi-user video conferencing application built with WebRTC, React, Node.js, and Socket.IO. Supports up to **6 participants** per room with real-time chat, screen sharing, local recording, host controls, and a fully responsive UI that works on desktop, tablet, and mobile.

---

## Screenshots

> Open two browser tabs to the same Room ID to test locally.

---

## Features

### Core Video Conferencing
- **Multi-user video calls** — up to 6 participants per room (mesh topology)
- **Dynamic video grid** — auto-adjusts layout (1 → 2 → 2×2 → 2×3 columns) as participants join or leave
- **Speaking indicator** — green animated ring highlights the active speaker using the Web Audio API analyser
- **Name labels & host badge** — overlaid on every video tile

### Media Controls
- **Mute / Unmute** microphone
- **Camera on / off** — shows avatar initials when video is disabled
- **Screen sharing** — share your screen or a specific tab with zero renegotiation via `replaceTrack()`
- **Microphone selection** — switch input device mid-call
- **Camera selection** — switch video device mid-call
- **Speaker/output selection** — route audio to a specific output device

### Recording
- **Local composite recording** — captures all participants in a single grid layout
- **Mixed audio** — all voices merged into one audio track via Web Audio API
- **In-call preview** — play back the recording before downloading
- **Download as WebM** — saved directly to your device, nothing uploaded
- **Live REC indicator** — pulsing dot and timer while recording is active

### Communication
- **Real-time chat** — text messaging during calls with unread badge
- **Participants list** — see who is in the room and their status (muted, camera off)

### Host Controls
- **Mute all** — silence all other participants at once
- **Remove participant** — kick a user from the room
- **Automatic host transfer** — if the host leaves, host role is passed to the next participant

### Reliability
- **ICE candidate queuing** — candidates arriving before SDP handshake completes are buffered and drained automatically
- **ICE restart** — automatically restarts ICE on connection failure
- **Socket.IO reconnection** — 10 automatic reconnect attempts with 1s delay
- **Room-full rejection** — server rejects the 7th joiner with a clear error screen
- **Device hot-plug** — microphone/camera list updates automatically when devices are plugged in

### Responsive UI
- **Desktop** — full sidebar panels, all controls visible
- **Tablet (≤900px)** — panels slide in as right-side overlays
- **Mobile (≤600px)** — full-screen bottom sheets, icon + label control row, 2-column video grid max, iOS zoom prevention
- **Touch optimised** — 44×44px minimum tap targets, `touch-action: manipulation` on all buttons

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19.2.5 |
| Build tool | Vite 8.0.10 |
| Styling | Vanilla CSS (custom design system, dark glassmorphism) |
| Real-time transport | WebRTC (browser native) |
| Signaling | Socket.IO 4.8.3 |
| Backend | Node.js + Express 5.2.1 |
| Recording | MediaRecorder API + Canvas composite + Web Audio API |

---

## Project Structure

```
nexmeet/
├── package.json                  ← root: runs both server + client via concurrently
├── .env.example                  ← environment variable reference
├── .gitignore
├── ARCHITECTURE.md               ← deep-dive: WebRTC flow, SFU migration, TURN setup
│
├── server/
│   ├── package.json
│   └── server.js                 ← Express + Socket.IO signaling server
│
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx              ← React entry point
        ├── App.jsx               ← top-level state machine (lobby → connecting → room)
        ├── App.css               ← all styles (tokens, layout, components, responsive)
        │
        ├── hooks/
        │   ├── useSocket.js          ← Socket.IO lifecycle + reconnection
        │   ├── useMediaDevices.js    ← getUserMedia, screen share, device switching
        │   ├── usePeerConnections.js ← RTCPeerConnection pool, offer/answer, ICE queuing
        │   ├── useAudioLevel.js      ← Web Audio analyser for speaking detection
        │   └── useRecording.js       ← canvas composite recording + audio mix + download
        │
        └── components/
            ├── Lobby.jsx             ← join screen: camera preview, New Room / Join tabs
            ├── Room.jsx              ← main room orchestrator: all socket + WebRTC events
            ├── VideoTile.jsx         ← single video tile with name label, mute/cam icons
            ├── Controls.jsx          ← bottom toolbar with all media + panel controls
            ├── ChatPanel.jsx         ← real-time chat sidebar
            ├── ParticipantsPanel.jsx ← participant list with host controls
            └── RecordingPanel.jsx    ← recording controls, live timer, preview + download
```

---

## Quick Start

### Prerequisites

- **Node.js** v18 or higher
- A browser with WebRTC support (Chrome, Firefox, Edge, Safari 15.4+)
- Camera and microphone (or at least a microphone for audio-only)

### 1. Install dependencies

```bash
# Install root dev tools
npm install

# Install server and client dependencies
npm install --prefix server
npm install --prefix client
```

### 2. Configure environment

```bash
cp .env.example client/.env
```

The default `client/.env` points to `http://localhost:3001`. No changes needed for local development.

### 3. Run in development mode

```bash
npm run dev
```

This starts both processes concurrently:
- **Signaling server** → `http://localhost:3001`
- **React client** → `http://localhost:5173`

Open `http://localhost:5173` in two separate browser windows (or tabs), enter any name, use the **same Room ID**, and click **Start / Join Meeting**.

### Individual processes

```bash
npm run dev:server   # server only (port 3001)
npm run dev:client   # client only (port 5173)
```

---

## Environment Variables

### `client/.env`

| Variable | Default | Description |
|---|---|---|
| `VITE_SOCKET_URL` | `http://localhost:3001` | URL of the signaling server |

### `server/.env` (optional)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port for the signaling server |

---

## WebRTC Connection Flow

```
New user (Bob) joins a room where Alice is already present:

1.  Bob  → server : join-room { roomId, userName }
2.  server → Bob  : room-joined { socketId, isHost, participants: [Alice] }
3.  Bob creates RTCPeerConnection for Alice, adds local tracks
4.  Bob calls pc.createOffer() → setLocalDescription
5.  Bob  → server → Alice : offer { SDP }
6.  Alice creates RTCPeerConnection for Bob, adds local tracks
7.  Alice calls pc.setRemoteDescription(offer) → createAnswer → setLocalDescription
8.  Alice → server → Bob  : answer { SDP }
9.  Bob calls pc.setRemoteDescription(answer)
10. Both sides exchange ICE candidates via 'ice-candidate' events
    (candidates that arrive before step 7/9 are queued and drained after)
11. RTCPeerConnection state → 'connected'
12. pc.ontrack fires on both sides → remote stream → <video> element
```

### Screen share track swap (zero renegotiation)

```
User clicks Share Screen:
  getDisplayMedia() → screenStream
  sender.replaceTrack(camTrack, screenTrack)  ← no new SDP needed
  emit 'screen-share-started'

User clicks Stop Sharing:
  sender.replaceTrack(screenTrack, camTrack)
  emit 'screen-share-stopped'
```

---

## STUN / TURN Configuration

Free STUN servers are pre-configured and work for ~85% of connections:

```js
// usePeerConnections.js
{ urls: 'stun:stun.l.google.com:19302' },
{ urls: 'stun:stun1.l.google.com:19302' },
{ urls: 'stun:stun.cloudflare.com:3478' },
```

For the remaining ~15% of users behind symmetric NAT (corporate networks, some mobile carriers), you need a **TURN server**. Add it to the `ICE_SERVERS` array:

```js
{
  urls: 'turn:your-turn-server.com:3478',
  username: 'your-username',
  credential: 'your-credential',
}
```

### Free / cheap TURN options

| Provider | Notes |
|---|---|
| [Cloudflare TURN](https://developers.cloudflare.com/calls/turn/) | Generous free tier, global edge |
| [Metered.ca](https://www.metered.ca/stun-turn) | Free tier available |
| [Twilio NTS](https://www.twilio.com/docs/stun-turn) | Pay-per-GB |
| Self-host [coturn](https://github.com/coturn/coturn) | Free, requires a VPS |

### Self-hosting coturn (Ubuntu)

```bash
sudo apt install coturn
sudo nano /etc/turnserver.conf
```

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
user=nexmeet:your-secret
realm=your-domain.com
log-file=/var/log/coturn/turn.log
```

```bash
sudo systemctl enable coturn && sudo systemctl start coturn
```

Open firewall ports: `3478/UDP+TCP`, `5349/UDP+TCP`, `49152-65535/UDP`

---

## Production Deployment

### 1. Build the client

```bash
# Set your production server URL first
echo "VITE_SOCKET_URL=https://api.yourdomain.com" > client/.env

npm run build   # outputs to client/dist/
```

### 2. Run the server

```bash
# With Node directly
NODE_ENV=production PORT=3001 node server/server.js

# With PM2 (recommended)
npm install -g pm2
pm2 start server/server.js --name nexmeet
pm2 save && pm2 startup
```

### 3. Nginx reverse proxy

```nginx
server {
  listen 443 ssl http2;
  server_name meet.yourdomain.com;

  ssl_certificate     /etc/letsencrypt/live/meet.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/meet.yourdomain.com/privkey.pem;

  # Serve React build
  location / {
    root /var/www/nexmeet/client/dist;
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  # Signaling server — must support WebSocket upgrade
  location /socket.io/ {
    proxy_pass         http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
  }
}
```

> **HTTPS is required** — browsers block `getUserMedia` on plain HTTP (localhost is exempt).

---

## Mesh vs SFU — Scaling Considerations

NexMeet uses a **mesh topology**: every peer connects directly to every other peer. This means each client uploads N-1 video streams.

| Participants | Upload streams per client | Mesh suitable? |
|:---:|:---:|:---:|
| 2 | 1 | ✅ |
| 4 | 3 | ✅ |
| 6 | 5 | ✅ (upper limit) |
| 10+ | 9+ | ❌ Use SFU |

For larger calls, integrate an **SFU (Selective Forwarding Unit)** like [LiveKit](https://livekit.io) (open source, self-hostable):

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev
```

```jsx
import { LiveKitRoom, VideoConference } from '@livekit/components-react';

<LiveKitRoom serverUrl="wss://your-livekit-server" token={token}>
  <VideoConference />
</LiveKitRoom>
```

---

## Browser Support

| Browser | Video/Audio | Screen Share | Speaker Select | Recording |
|---|:---:|:---:|:---:|:---:|
| Chrome 90+ | ✅ | ✅ | ✅ | ✅ |
| Firefox 90+ | ✅ | ✅ | ❌ | ✅ |
| Edge 90+ | ✅ | ✅ | ✅ | ✅ |
| Safari 15.4+ | ✅ | ❌ iOS / ✅ macOS | ❌ | ✅ |
| Mobile Chrome | ✅ | ❌ | ❌ | ✅ |
| Mobile Safari | ✅ | ❌ | ❌ | ✅ |

> Screen share (`getDisplayMedia`) is not available on iOS Safari. The Share Screen button is still shown but will produce a browser-native error which is handled gracefully.

---

## Known Edge Cases & Handling

| Scenario | Handling |
|---|---|
| Camera/mic permission denied | Error screen with clear message, lobby is still accessible |
| Room is full (7th joiner) | Server emits `room-full`, client shows dedicated error screen |
| Peer disconnects unexpectedly | `onconnectionstatechange` → `closePeer()` → tile removed |
| ICE failure | `pc.restartIce()` called automatically |
| Host leaves | Server promotes next participant, all clients notified |
| Screen share stopped via browser button | `screenTrack.onended` fires → `replaceTrack` back to camera |
| Socket disconnects mid-call | Socket.IO auto-reconnects; `room-joined` re-initialises peers |
| No camera found | `NotFoundError` caught, user shown a helpful message |

---

## API Reference — Socket Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join-room` | `{ roomId, userName }` | Join or create a room |
| `offer` | `{ to, offer }` | Send SDP offer to a peer |
| `answer` | `{ to, answer }` | Send SDP answer to a peer |
| `ice-candidate` | `{ to, candidate }` | Send ICE candidate to a peer |
| `media-state` | `{ roomId, isMuted, isVideoOff }` | Broadcast local mute/video state |
| `screen-share-started` | `{ roomId }` | Notify room screen share began |
| `screen-share-stopped` | `{ roomId }` | Notify room screen share ended |
| `chat-message` | `{ roomId, message }` | Send chat message |
| `mute-all` | `{ roomId }` | Host: mute all other participants |
| `remove-user` | `{ roomId, targetSocketId }` | Host: remove a participant |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `room-joined` | `{ socketId, isHost, participants[] }` | Confirmed join with existing peers |
| `user-joined` | `{ socketId, name, isHost }` | New participant joined |
| `user-left` | `{ socketId }` | Participant disconnected |
| `room-full` | `{ max }` | Room is at capacity |
| `offer` | `{ from, offer }` | Incoming SDP offer |
| `answer` | `{ from, answer }` | Incoming SDP answer |
| `ice-candidate` | `{ from, candidate }` | Incoming ICE candidate |
| `peer-media-state` | `{ socketId, isMuted, isVideoOff }` | Peer mute/video changed |
| `peer-screen-share` | `{ socketId, sharing }` | Peer screen share changed |
| `chat-message` | `{ id, from, name, message, timestamp }` | Incoming chat message |
| `host-mute-all` | — | Host muted everyone |
| `host-transferred` | `{ socketId }` | New host assigned |
| `removed-from-room` | — | You were removed by the host |

---

## Scripts Reference

```bash
# From the project root:
npm install              # install root dev tools (concurrently)
npm run install:all      # install server + client dependencies
npm run dev              # start both server and client (development)
npm run dev:server       # start signaling server only
npm run dev:client       # start React dev server only
npm run build            # build client for production → client/dist/
npm start                # start production server

# From client/:
npm run dev              # Vite dev server (HMR)
npm run build            # production build
npm run preview          # preview the production build locally

# From server/:
npm run dev              # nodemon (auto-restart on file changes)
npm start                # node server.js (production)
```

---

## License

MIT — free to use, modify and distribute.

---

## Acknowledgements

- [WebRTC](https://webrtc.org/) — browser P2P media standard
- [Socket.IO](https://socket.io/) — reliable WebSocket signaling
- [Vite](https://vitejs.dev/) — blazing fast frontend tooling
- [Google STUN](https://developers.google.com/talk/libjingle/important_applications) — free public STUN servers
- [Syne](https://fonts.google.com/specimen/Syne) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) — typography
