# NexMeet Architecture

This document describes the current NexMeet implementation: a small-room WebRTC mesh app with Socket.IO signaling, local-only recording, raised hands, host controls, live screen-share annotations, and direction-aware screen-share peer connections.

## 1. System Overview

```text
Browser client A                    Signaling server                    Browser client B
React UI                            Express + Socket.IO                 React UI
Socket.IO client <--------------->  room/chat/control events  <------>  Socket.IO client
WebRTC RTCPeerConnection <-------------------------------------------> WebRTC RTCPeerConnection
P2P SRTP media: camera, mic, screen share
```

The server does not proxy media. Camera, microphone, and screen-share tracks flow directly between browsers after the signaling handshake completes.

### Server responsibilities

- Accept Socket.IO connections.
- Track in-memory room membership and participant metadata.
- Enforce the 6-participant room limit.
- Relay SDP offers, answers, and ICE candidates.
- Relay chat messages.
- Broadcast mute/video and raised-hand state.
- Enforce a maximum of 2 active screen sharers per room.
- Track per-screen annotation grants and relay live annotation events.
- Handle host-only mute-all, mute-user, and remove-user actions.
- Transfer host role when the current host leaves.
- Expose lightweight health and room-info endpoints.

### Server non-goals

- No media forwarding, mixing, transcoding, or recording.
- No persistent chat storage.
- No persistent annotation history.
- No authentication or authorization beyond host checks for host actions.
- No database; room state is process-local memory.

## 2. Runtime Components

### Root

- `package.json` runs client and server scripts from the repository root.
- `README.md` is the user-facing setup and feature guide.
- `ARCHITECTURE.md` is this implementation guide.

### Server

- `server/server.js`
  - Express app and HTTP server.
  - Socket.IO server with permissive CORS for development.
  - `rooms`: `Map<roomId, Map<socketId, participant>>`.
  - `roomScreenShares`: `Map<roomId, Set<socketId>>`.
  - `roomAnnotationGrants`: `Map<roomId, Map<screenOwnerId, Set<grantedSocketId>>>`.
  - `MAX_PARTICIPANTS = 6`.
  - `MAX_SCREEN_SHARES = 2`.

### Client

- `client/src/App.jsx`
  - App phase state: lobby, connecting, room, error.
  - Reads invite room IDs from `?room=...` and writes the joined room back to the URL.
  - Starts local media before mounting `Room`, so peer connections can immediately attach local tracks.
  - Shows connection and media errors.

- `client/src/hooks/useSocket.js`
  - Creates the Socket.IO client.
  - Defaults to the current hostname with port `3001` when `VITE_SOCKET_URL` is not set.
  - Uses websocket transport and 10 reconnect attempts.

- `client/src/hooks/useMediaDevices.js`
  - Captures local camera/microphone.
  - Falls back to audio-only or video-only when one device type fails.
  - Tracks selected mic, camera, and speaker devices.
  - Handles device switching and device hot-plug.
  - Captures screen streams with `getDisplayMedia({ video, audio: true })`.
  - Uses 1280x720 camera capture and 1920x1080 screen capture targets at up to 30 fps.

- `client/src/hooks/usePeerConnections.js`
  - Owns WebRTC camera/mic peer connections.
  - Owns dedicated screen-share peer connections.
  - Queues ICE candidates until a remote description exists.
  - Applies sender encoding constraints for camera and screen video.
  - Restarts ICE when connection state becomes failed.

- `client/src/hooks/useRecording.js`
  - Creates a 1280x720 canvas compositor.
  - Draws all provided participant streams into a grid.
  - Mixes audio streams into a `MediaStreamDestination`.
  - Records canvas video plus mixed audio through `MediaRecorder`.

- `client/src/hooks/useAnnotations.js`
  - Stores finalized annotation shapes by `screenOwnerId`.
  - Emits draw, undo, and clear events once shapes are finalized.
  - Applies incoming annotation events from Socket.IO.
  - Removes a screen's local shape state when that share ends.

- `client/src/components/Room.jsx`
  - Registers socket listeners.
  - Emits `join-room` after listeners are attached.
  - Orchestrates camera signaling, screen-share signaling, chat, hands, host events, annotations, recording, and cleanup.
  - Builds separate camera participant tiles and screen-share tiles.
  - Supports presentation layout for one or two active screen shares.

- `client/src/components/AnnotationOverlay.jsx`
  - Renders an SVG overlay on top of a screen-share video.
  - Stores shape coordinates as 0-1 fractions of the actual letterboxed video content.
  - Captures pointer input only when the current user has drawing access and a tool is selected.

- `client/src/components/AnnotationToolbar.jsx`
  - Provides pen, highlighter, line, arrow, rectangle, circle, color, undo, clear, and target-selection controls.

## 3. Room Join and Camera Handshake

The client starts local media before joining the room. This prevents peer connections from being created before local tracks are available.

```text
User submits lobby form
  App.startLocalStream()
  App mounts Room
  Room registers socket listeners
  Room emits join-room { roomId, userName, isMuted, isVideoOff }
```

When a new participant joins an existing room:

```text
Bob -> server: join-room
server -> Bob: room-joined { socketId, isHost, participants: [Alice], screenSharingSocketIds }
server -> Alice: user-joined { socketId: Bob, ...mediaState }

Bob:
  create camera RTCPeerConnection for Alice
  add local audio/video tracks
  createOffer
  setLocalDescription
  emit offer { to: Alice, kind: 'camera' }

Alice:
  receive offer { from: Bob, kind: 'camera' }
  create camera RTCPeerConnection for Bob
  add local audio/video tracks
  setRemoteDescription
  drain queued camera ICE candidates
  createAnswer
  setLocalDescription
  emit answer { to: Bob, kind: 'camera' }

Bob:
  receive answer { from: Alice, kind: 'camera' }
  setRemoteDescription
  drain queued camera ICE candidates

Both peers:
  exchange ice-candidate { kind: 'camera' }
  receive remote tracks
  merge tracks into one persistent MediaStream per socketId
  render VideoTile
```

### Why the client builds persistent remote streams

`ontrack` can fire separately for audio and video. Some browsers do not consistently provide the same `event.streams[0]` identity for both tracks. NexMeet avoids that browser-dependent behavior by creating one `MediaStream` per remote socket ID and upserting tracks into it.

## 4. Signaling Event Routing

The same Socket.IO events carry both camera and screen-share negotiation. The `kind` field routes each payload to the correct peer-connection pool.

```text
offer         { from, offer, kind: 'camera' | 'screen' }
answer        { from, answer, kind: 'camera' | 'screen' }
ice-candidate { from, candidate, kind: 'camera' | 'screen' }
```

If `kind` is missing, the client treats it as camera signaling for backwards compatibility.

## 5. Camera Peer Connections

Camera/mic PCs are keyed by remote socket ID:

```text
peerConnections: socketId -> RTCPeerConnection
iceCandidateQueues: socketId -> RTCIceCandidate[]
remoteStreams: socketId -> MediaStream
```

Each camera PC:

- Adds all local tracks from `localStreamRef.current`.
- Applies camera video encoding constraints: 2 Mbps max bitrate and 30 fps max framerate.
- Sends ICE candidates with `kind: 'camera'`.
- Queues incoming ICE candidates until `remoteDescription` is set.
- Uses a gated `onnegotiationneeded` flow for ICE restart renegotiation.
- Calls `pc.restartIce()` when connection state is `failed`.

Device switching uses `RTCRtpSender.replaceTrack()` on camera PCs. That is separate from screen sharing; screen shares do not replace the camera track.

## 6. Screen Sharing Architecture

Screen sharing is intentionally separate from camera/mic connections.

### Current model

A screen share gets a dedicated `RTCPeerConnection` for each viewer. The implementation also separates direction, because two users can share screens with each other at the same time.

```text
outgoingScreenPCs: remoteSocketId -> PC where local user sends screen
incomingScreenPCs: remoteSocketId -> PC where local user receives remote screen
outgoingScreenIceQueues: remoteSocketId -> RTCIceCandidate[]
incomingScreenIceQueues: remoteSocketId -> RTCIceCandidate[]
remoteScreenStreams: remoteSocketId -> MediaStream
```

This prevents one direction from overwriting the other direction when two users share simultaneously.

### Start screen share flow

```text
Local user clicks Share Screen
  startScreenShare()
  navigator.mediaDevices.getDisplayMedia({ video, audio: true })
  socket.emit('screen-share-started', { roomId }, ack)

Server:
  if socket already sharing: ack { ok: true }
  else if room has 2 active shares: ack { ok: false, max: 2 }
  else add socketId to roomScreenShares and broadcast peer-screen-share { sharing: true }

Client on ack ok:
  mark local socket as active sharer
  for each current remote participant:
    create outgoing screen PC
    add all screen stream tracks, including tab/system audio if granted
    createOffer
    setLocalDescription
    emit offer { to, kind: 'screen' }
```

### Receive screen share flow

```text
Viewer receives offer { from: sharer, kind: 'screen' }
  create incoming screen PC for sharer
  setRemoteDescription
  drain incoming screen ICE queue
  createAnswer
  setLocalDescription
  emit answer { to: sharer, kind: 'screen' }

Viewer receives screen tracks
  upsert tracks into remoteScreenStreams[sharer]
  render as a screen-share VideoTile
```

### Stop screen share flow

```text
User clicks Stop Sharing or browser native stop button fires track.onended
  stop local screen tracks
  close outgoing screen PCs only
  emit screen-share-stopped { roomId }
  remove local active-sharer marker

Peers receive peer-screen-share { socketId, sharing: false }
  close incoming screen PC for that socketId only
  remove remote screen tile
```

A full participant departure closes both outgoing and incoming screen PCs for that socket ID.

### Late joiners

When a user joins a room with active screen shares, `room-joined` includes `screenSharingSocketIds`. Active sharers also listen for `user-joined`; if they are currently sharing, they create a fresh outgoing screen offer for the newcomer.

## 7. Presentation Layout

`Room.jsx` renders camera tiles and screen-share tiles separately.

- No active share: render the normal camera grid.
- One active share: render it as the main presentation area, with camera tiles in the sidebar.
- Two active shares with no pinned share: render both in the main presentation area side by side.
- Two active shares with a pinned share: render the pinned share as main and the other in the sidebar.

The client tracks active sharers in `activeSharerIds`, which includes both local and remote sharers.

## 8. Annotation Architecture

Annotations are drawn as client-side SVG overlays on top of screen-share video tiles. They are not baked into the WebRTC screen-share track, so the shared video remains untouched and annotation latency does not affect screen capture encoding.

### Shape model

`useAnnotations` stores shapes by screen owner:

```text
shapesByScreen: screenOwnerId -> Shape[]
```

Each shape has an ID, tool, color, and normalized coordinates. Freehand pen/highlighter shapes store point arrays. Line, arrow, rectangle, and circle shapes store start/end coordinates. `AnnotationOverlay` converts those normalized coordinates back into pixels using the actual letterboxed content rectangle of the video element, so marks stay aligned across main view, sidebar view, split presentation view, and different participant window sizes.

### Access model

The screen owner can always draw on their own active screen share. Viewers must request access before drawing on someone else's share.

```text
Viewer clicks Request draw
  socket.emit('annotation-request-access', { roomId, screenOwnerId }, ack)

Server:
  verifies requester and screen owner are in the room
  verifies screenOwnerId is actively sharing
  emits annotation-access-requested to the screen owner

Screen owner clicks Allow or Deny
  socket.emit('annotation-access-response', { roomId, requesterSocketId, approved }, ack)

Server:
  verifies the responder owns an active screen share
  updates roomAnnotationGrants[roomId][screenOwnerId]
  emits annotation-access-updated to the requester
  emits annotation-access-grant-updated to the owner
```

Owners can revoke access through `annotation-access-revoke`. When a screen share stops, when a participant leaves, or when a participant is removed, the server clears affected grants and notifies clients.

### Draw flow

```text
User draws on AnnotationOverlay
  overlay captures pointer events only when drawing is allowed
  in-progress shape is previewed locally
  pointer release finalizes shape
  useAnnotations.addShape stores it locally
  socket.emit('annotation-draw', { roomId, screenOwnerId, shape })

Server:
  canAnnotate(roomId, screenOwnerId, socket.id)
  if allowed, socket.to(roomId).emit('annotation-draw', { screenOwnerId, shape })

Peers:
  append shape to shapesByScreen[screenOwnerId]
  render the same shape over the matching screen-share tile
```

Undo and clear follow the same authorization path with `annotation-undo` and `annotation-clear`.

### Constraints

- Annotation state is live and ephemeral.
- The server does not store shape history or replay old shapes to late joiners.
- Shape lists are scoped by `screenOwnerId`, so two simultaneous shares can be annotated independently.
- Local cleanup removes shapes when the corresponding screen share ends.

## 9. Recording Architecture

Recording is local to the user who starts it.

```text
RecordingPanel -> Room.startRecording([...screenTiles, ...allParticipants])
useRecording:
  create 1280x720 canvas
  draw active streams in a grid at ~30 fps
  render avatar fallback when a video frame is unavailable
  draw participant labels and REC marker
  build Web Audio mix from all stream audio tracks
  canvas.captureStream(30)
  add mixed audio track
  MediaRecorder.start(1000)
```

When recording stops:

- The `MediaRecorder` builds a Blob from collected chunks.
- The panel creates an object URL for preview.
- Download uses `nexmeet-{roomId}-{timestamp}.webm` from `Room.jsx`.
- The recording never leaves the browser.

## 10. Socket API

### Client to server

| Event | Payload | Notes |
| --- | --- | --- |
| `join-room` | `{ roomId, userName, isMuted, isVideoOff }` | Creates room if needed |
| `offer` | `{ to, offer, kind }` | `kind` is `camera` or `screen` |
| `answer` | `{ to, answer, kind }` | Routed directly to `to` |
| `ice-candidate` | `{ to, candidate, kind }` | Routed directly to `to` |
| `media-state` | `{ roomId, isMuted, isVideoOff }` | Updates server copy and broadcasts |
| `hand-state` | `{ roomId, raised }` | Updates server copy and broadcasts |
| `screen-share-started` | `{ roomId }`, ack | Enforces max 2 active sharers |
| `screen-share-stopped` | `{ roomId }` | Releases screen-share slot |
| `annotation-request-access` | `{ roomId, screenOwnerId }`, ack | Request permission to draw on a screen share |
| `annotation-access-response` | `{ roomId, requesterSocketId, approved }`, ack | Screen owner allows or denies draw access |
| `annotation-access-revoke` | `{ roomId, screenOwnerId, targetSocketId }`, ack | Screen owner revokes draw access |
| `annotation-draw` | `{ roomId, screenOwnerId, shape }` | Relays a finalized annotation shape |
| `annotation-undo` | `{ roomId, screenOwnerId, shapeId }` | Relays removal of one shape |
| `annotation-clear` | `{ roomId, screenOwnerId }` | Relays clear for one screen's shapes |
| `chat-message` | `{ roomId, message }` | Server adds id/name/timestamp |
| `mute-all` | `{ roomId }` | Host-only server check |
| `mute-user` | `{ roomId, targetSocketId }` | Host-only server check |
| `remove-user` | `{ roomId, targetSocketId }` | Host-only server check |

### Server to client

| Event | Payload | Notes |
| --- | --- | --- |
| `room-joined` | `{ socketId, isHost, participants, screenSharingSocketIds }` | Sent to joining socket |
| `user-joined` | `{ socketId, name, isHost, isMuted, isVideoOff, handRaised }` | Broadcast to existing sockets |
| `user-left` | `{ socketId }` | Triggers PC cleanup |
| `room-full` | `{ max }` | Sent to rejected joiner |
| `offer` | `{ from, offer, kind }` | Camera or screen offer |
| `answer` | `{ from, answer, kind }` | Camera or screen answer |
| `ice-candidate` | `{ from, candidate, kind }` | Camera or screen ICE |
| `peer-media-state` | `{ socketId, isMuted, isVideoOff }` | Updates peer tile state |
| `peer-hand-state` | `{ socketId, raised }` | Updates peer raised-hand state |
| `peer-screen-share` | `{ socketId, sharing }` | Updates screen-share state |
| `annotation-access-requested` | `{ screenOwnerId, requesterSocketId, requesterName }` | Screen owner receives request |
| `annotation-access-updated` | `{ screenOwnerId, granted }` | Requester receives grant status |
| `annotation-access-grant-updated` | `{ screenOwnerId, socketId, name?, granted }` | Screen owner receives grant-list update |
| `annotation-access-revoked` | `{ screenOwnerId, socketId }` | Screen owner receives revoke cleanup |
| `annotation-draw` | `{ screenOwnerId, shape }` | Adds a remote annotation shape |
| `annotation-undo` | `{ screenOwnerId, shapeId }` | Removes a remote annotation shape |
| `annotation-clear` | `{ screenOwnerId }` | Clears remote annotation shapes |
| `chat-message` | `{ id, from, name, message, timestamp }` | Appended to chat panel |
| `host-mute-all` | none | Receiver mutes local audio track |
| `host-mute-user` | none | Receiver mutes local audio track |
| `host-transferred` | `{ socketId }` | Updates host badges and host controls |
| `removed-from-room` | none | Receiver leaves room after alert |

## 11. REST API

| Method | Path | Response |
| --- | --- | --- |
| GET | `/health` | `{ status: 'ok' }` |
| GET | `/room/:roomId/info` | `{ exists, count, screenSharesActive, maxScreenShares }` |

## 12. Media and Device Handling

### Initial capture

`useMediaDevices.startLocalStream()` first tries audio plus video. If that fails, it tries audio-only, then video-only. It only throws when neither path works.

Captured tracks are enabled or disabled based on the lobby's initial mute/camera-off choices.

### Switching devices

- Microphone switching captures a new audio-only stream, preserves current video tracks, stops only the old audio tracks, and asks `Room.jsx` to replace the audio track on active camera PCs.
- Camera switching captures a new video-only stream, preserves current audio tracks, stops the old video track, and asks `Room.jsx` to replace the video track on active camera PCs.
- Speaker switching calls `setSinkId()` on audio/video elements when supported.

### Browser limitations

- iOS Safari does not support `getDisplayMedia`, so screen sharing is disabled by feature detection.
- Firefox and Safari do not support `setSinkId`, so speaker selection may be unavailable.
- Production capture requires HTTPS, except on localhost.

## 13. Reliability and Cleanup

### ICE candidate queuing

For both camera and screen-share connections, incoming ICE candidates can arrive before the SDP remote description is set. NexMeet queues candidates by socket ID and connection type, then drains the queue after `setRemoteDescription()`.

### ICE restart

When a camera or screen-share PC reaches `connectionState === 'failed'`, the client calls `restartIce()`. The gated `onnegotiationneeded` handler creates and signals a fresh offer when the connection is stable.

### Leave and disconnect

Local leave:

- Stop recording if active.
- Emit `screen-share-stopped` if sharing.
- Close all camera PCs.
- Close all outgoing and incoming screen PCs.
- Drop local annotation shapes and access UI for ended shares.
- Stop local camera, microphone, and screen tracks.
- Return to the lobby.

Server disconnect:

- Remove the socket from each room it joined.
- Release any screen-share slot held by the socket.
- Clear annotation grants for screens owned by the socket.
- Revoke annotation access granted to the socket.
- Broadcast `peer-screen-share` false if needed.
- Broadcast `user-left`.
- Transfer host if the leaving socket was host.
- Delete empty room, screen-share, and annotation-grant state.

## 14. Scaling and Production Notes

### Mesh limits

Mesh is simple and works well for small calls, but each participant uploads to every other participant. At 6 participants, each client sends up to 5 camera streams, plus additional outgoing streams when sharing a screen.

For larger rooms, migrate media to an SFU such as LiveKit, mediasoup, or Janus. Socket.IO can still remain for app-level events such as chat, host controls, and room metadata.

### Production hardening checklist

- Add authentication and room authorization.
- Restrict Socket.IO CORS origins.
- Add TURN servers to `ICE_SERVERS`.
- Put the server behind HTTPS with WebSocket upgrade support.
- Use a shared store such as Redis if scaling the signaling server horizontally.
- Add server-side rate limits for chat and signaling events.
- Add server-side rate limits for annotation events.
- Consider structured logging and room metrics.

## 15. Important Current Constraints

- Rooms and chat messages are in-memory only.
- Annotation grants and shapes are live-session state only; shapes are not stored on the server.
- Refreshing the server process drops all rooms.
- Host identity is not authenticated.
- Recording is local and records the local user's received media/layout only.
- Screen sharing depends on browser support for `getDisplayMedia`.
- The app is designed for up to 6 participants, not large webinars.
