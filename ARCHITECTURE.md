# NexMeet — WebRTC Video Conferencing
## Complete Architecture & Developer Guide

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER A                            │
│  React App  →  Socket.IO  →  WebRTC PeerConnection (mesh)  │
└──────────────────┬──────────────────────┬───────────────────┘
                   │ Signaling            │ Media (P2P)
         ┌─────────▼─────────┐           │
         │  Node.js Server   │           │ RTP/SRTP streams
         │  Express +        │           │ (no server hop)
         │  Socket.IO        │           │
         └─────────▲─────────┘           │
                   │ Signaling           │ Media (P2P)
┌──────────────────┴──────────────────────┴───────────────────┐
│                        BROWSER B                            │
│  React App  →  Socket.IO  →  WebRTC PeerConnection (mesh)  │
└─────────────────────────────────────────────────────────────┘
```

### What the signaling server does
- Relays SDP offers/answers and ICE candidates between peers
- Tracks room membership and participant metadata
- Enforces host controls (mute-all, remove-user)
- Relays chat messages and media-state updates
- Transfers host role on disconnect

### What the signaling server does NOT do
- Touch audio/video — all media flows P2P via WebRTC
- Store messages permanently — in-memory only
- Authenticate users — add JWT/session middleware for production

---

## 2. Folder Structure

```
nexmeet/
├── package.json              ← root scripts (concurrently)
├── .env.example
│
├── server/
│   ├── package.json
│   └── server.js             ← Express + Socket.IO signaling
│
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx           ← React entry point
        ├── App.jsx            ← top-level state machine (lobby → room)
        ├── App.css            ← all styles (dark glassmorphism)
        │
        ├── hooks/
        │   ├── useSocket.js          ← Socket.IO connection lifecycle
        │   ├── useMediaDevices.js    ← getUserMedia, device switching, screen share
        │   ├── usePeerConnections.js ← RTCPeerConnection pool, offer/answer
        │   └── useAudioLevel.js      ← Web Audio API speaking detection
        │
        └── components/
            ├── Lobby.jsx             ← join screen with camera preview
            ├── Room.jsx              ← main room, orchestrates all events
            ├── VideoTile.jsx         ← single video with overlay labels
            ├── Controls.jsx          ← toolbar (mute, video, share, chat…)
            ├── ChatPanel.jsx         ← real-time chat sidebar
            └── ParticipantsPanel.jsx ← participant list with host controls
```

---

## 3. WebRTC Connection Flow

### 3a. Full offer/answer handshake

```
Alice joins room (alone)
  → server: join-room { roomId, userName }
  ← server: room-joined { socketId, isHost: true, participants: [] }
  (Alice waits)

Bob joins same room
  → server: join-room { roomId, userName }
  ← server: room-joined { socketId, isHost: false, participants: [Alice] }
  Bob creates RTCPeerConnection for Alice
  Bob calls pc.createOffer()
  Bob sets localDescription
  → server: offer { to: Alice.socketId, offer: SDP }

  Alice receives offer event
  Alice creates RTCPeerConnection for Bob
  Alice sets remoteDescription (Bob's offer)
  Alice calls pc.createAnswer()
  Alice sets localDescription
  → server: answer { to: Bob.socketId, answer: SDP }

  Bob receives answer
  Bob sets remoteDescription (Alice's answer)

  Both sides exchange ICE candidates via 'ice-candidate' events
  RTCPeerConnection state → 'connected'
  pc.ontrack fires → remote stream attached to <video>
```

### 3b. ICE candidate trickle

```
Each side:
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('ice-candidate', { to, candidate })
  }

Remote side:
  socket.on('ice-candidate', async ({ from, candidate }) => {
    await pc.addIceCandidate(new RTCIceCandidate(candidate))
  })
```

### 3c. Mesh topology trade-offs

| Topology | How it works | Best for | Downside |
|---|---|---|---|
| **Mesh (this app)** | Every peer connects to every other peer | ≤6 users | Upload bandwidth grows as O(n²) |
| **SFU** (Selective Forwarding Unit) | Peers send once to a media server; server fans out | 6–500 users | Requires media server (mediasoup, Janus, LiveKit) |
| **MCU** | Server mixes all streams into one | Legacy/low-bandwidth clients | High server CPU; latency |

For production at >6 participants, integrate [LiveKit](https://livekit.io) or [mediasoup](https://mediasoup.org) as an SFU.

---

## 4. Screen Sharing Flow

```
User clicks "Share Screen"
  → navigator.mediaDevices.getDisplayMedia() → screenStream
  → get screenTrack = screenStream.getVideoTracks()[0]
  → get camTrack = localStream.getVideoTracks()[0]
  → for each RTCPeerConnection:
       sender.replaceTrack(camTrack, screenTrack)   ← no renegotiation needed!
  → socket.emit('screen-share-started')
  → remote peers receive 'peer-screen-share' → update UI

User clicks "Stop Sharing" (or browser stop button)
  → screenTrack.onended fires
  → replaceTrack(screenTrack, camTrack)
  → socket.emit('screen-share-stopped')
```

`replaceTrack()` swaps the track on the existing sender without SDP renegotiation — zero interruption for remote viewers.

---

## 5. STUN / TURN Configuration

### STUN (free, handles most cases)

```js
// Already configured in usePeerConnections.js
{ urls: 'stun:stun.l.google.com:19302' }
{ urls: 'stun:stun.cloudflare.com:3478' }
```

STUN lets peers discover their public IP. Works for ~85% of connections.

### TURN (required for ~15% — corporate/symmetric NAT)

```js
// Add to ICE_SERVERS array in usePeerConnections.js:
{
  urls: 'turn:your-turn.example.com:3478',
  username: 'nexmeet',
  credential: 'your-secret',
}
```

#### Self-hosting coturn (Ubuntu)

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

Open ports: **3478/UDP+TCP**, **5349/UDP+TCP**, **49152-65535/UDP** (relay range)

#### Managed TURN options
- **Cloudflare TURN** — generous free tier, global PoPs
- **Twilio Network Traversal** — pay-per-GB
- **Metered.ca** — free tier available

---

## 6. Bandwidth Optimization

### Encoding constraints (add to peer connection)

```js
// After creating offer, apply bandwidth cap:
const sender = pc.getSenders().find(s => s.track.kind === 'video');
const params = sender.getParameters();
params.encodings[0].maxBitrate = 800_000; // 800 kbps per peer
await sender.setParameters(params);
```

### Simulcast (advanced — requires SFU)

With an SFU like LiveKit you can send 3 spatial layers (high/med/low). The SFU forwards the appropriate layer per receiver based on their bandwidth.

### Dynamic quality

```js
// Lower resolution when >4 participants
const constraints = count > 4
  ? { width: 640, height: 360 }
  : { width: 1280, height: 720 };
```

---

## 7. Edge Cases & Error Handling

### Permission denied

```js
try {
  await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
} catch (err) {
  if (err.name === 'NotAllowedError') {
    // Show UI: "Please allow camera/mic access in browser settings"
  } else if (err.name === 'NotFoundError') {
    // Show UI: "No camera/microphone found"
  }
}
```

### Peer ICE failure → auto-restart

```js
pc.onconnectionstatechange = () => {
  if (pc.connectionState === 'failed') pc.restartIce();
};
```

`restartIce()` triggers a new ICE gathering cycle. The offerer must create a new offer — handled by the peer that made the original offer.

### User leaves / browser closes

The server handles `disconnecting` (fires before socket rooms are cleared):
- Removes participant from room map
- Emits `user-left` to remaining peers
- Transfers host if the leaving user was host
- Client side: `usePeerConnections.closePeer()` closes that PC and cleans up the video tile

### Socket reconnection

Socket.IO auto-reconnects (10 attempts, 1s delay). On reconnect you need to re-join the room:

```js
socket.on('reconnect', () => {
  socket.emit('join-room', { roomId, userName });
});
```

### Device hot-plug (mic/camera swap)

```js
navigator.mediaDevices.addEventListener('devicechange', async () => {
  const newDevices = await navigator.mediaDevices.enumerateDevices();
  // update device list in UI
});
```

Switching mid-call uses `sender.replaceTrack(newTrack)` — same pattern as screen share.

### Mobile Safari quirks

- Requires `playsInline` on all `<video>` elements ✅ (already set)
- `setSinkId()` not supported (speaker selection) — show warning
- `getDisplayMedia()` not supported on iOS — hide screen share button:
  ```js
  const canShare = !!navigator.mediaDevices.getDisplayMedia;
  ```

---

## 8. Recording Support (Bonus)

### Client-side (single user's view)

```js
const recorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm' });
const chunks = [];
recorder.ondataavailable = (e) => chunks.push(e.data);
recorder.onstop = () => {
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  // trigger download
  const a = document.createElement('a');
  a.href = url; a.download = 'meeting.webm'; a.click();
};
recorder.start();
```

### Server-side composite recording

Use [Puppeteer](https://pptr.dev) to headlessly join the room and pipe the screen capture through ffmpeg — produces a composite recording of all participants.

---

## 9. Quick Start

```bash
# 1. Clone / copy the project
cd nexmeet

# 2. Install all dependencies
npm install          # root (concurrently)
npm install --prefix server
npm install --prefix client

# 3. Configure environment
cp .env.example client/.env
# Edit client/.env: VITE_SOCKET_URL=http://localhost:3001

# 4. Run both server and client
npm run dev

# Server → http://localhost:3001
# Client → http://localhost:5173
```

Open two browser tabs (or two different browsers) to `http://localhost:5173`, use the **same Room ID**, and connect!

---

## 10. Production Deployment

### Server (Node.js)

```bash
# On your VPS / cloud instance
npm install --prefix server --production
NODE_ENV=production PORT=3001 node server/server.js

# Or with PM2 for process management:
npm install -g pm2
pm2 start server/server.js --name nexmeet-signal
pm2 save && pm2 startup
```

### Client (Static hosting)

```bash
# Build the React app
npm run build --prefix client
# Output: client/dist/

# Serve with nginx, Vercel, Cloudflare Pages, etc.
# Point VITE_SOCKET_URL to your production server URL before building
```

### Nginx reverse proxy (recommended)

```nginx
server {
  listen 443 ssl;
  server_name meet.yourdomain.com;

  ssl_certificate     /etc/letsencrypt/live/meet.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/meet.yourdomain.com/privkey.pem;

  # Serve React build
  location / {
    root /var/www/nexmeet/client/dist;
    try_files $uri $uri/ /index.html;
  }

  # Proxy signaling server (WebSocket-aware)
  location /socket.io/ {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

> **Note:** HTTPS is mandatory for WebRTC in production — `getUserMedia` is blocked on plain HTTP (except localhost).

---

## 11. Scaling Beyond Mesh

When you need >6-8 concurrent participants per room, migrate to an SFU:

### LiveKit (recommended — open source, self-hostable)

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev
```

Replace `usePeerConnections.js` with the [LiveKit React SDK](https://docs.livekit.io/realtime/quickstarts/react/):

```js
import { LiveKitRoom, VideoConference } from '@livekit/components-react';

<LiveKitRoom serverUrl="wss://your-livekit-server" token={token}>
  <VideoConference />
</LiveKitRoom>
```

The signaling server can generate LiveKit access tokens via the LiveKit Node SDK — your existing Socket.IO server for chat/host-controls can remain alongside it.
