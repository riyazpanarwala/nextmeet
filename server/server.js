const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Moved above the Server() call so it can size maxHttpBufferSize correctly —
// see SOCKET_MAX_BUFFER_BYTES below.
const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

// Base64 inflates raw bytes by ~1.37x, and the actual Socket.IO frame also
// carries the JSON envelope (message text up to 2000 chars, replyTo, room id,
// event name, etc.) plus the "data:<mime>;base64," prefix. Socket.IO's
// default maxHttpBufferSize (1MB) silently disconnects the socket — with no
// error surfaced to the client — for any file over ~730KB raw. This sizes
// the buffer to comfortably cover a full 5MB file plus that overhead.
const SOCKET_MAX_BUFFER_BYTES = Math.ceil(MAX_CHAT_FILE_BYTES * 1.5) + 64 * 1024;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: SOCKET_MAX_BUFFER_BYTES,
});

// roomId -> Map<socketId, { name, isHost, isMuted, isVideoOff, handRaised }>
const rooms = new Map();
const MAX_PARTICIPANTS = 6;

// roomId -> { locked: boolean, password: string }
const roomSecurity = new Map();

// roomId -> Map<socketId, pending participant payload>
const roomWaitingRequests = new Map();

// roomId -> Set<socketId> currently screen-sharing
const roomScreenShares = new Map();
const MAX_SCREEN_SHARES = 2;

// roomId -> Map<screenOwnerId, Set<grantedSocketId>>
const roomAnnotationGrants = new Map();

// roomId -> Map<screenOwnerId, Shape[]>
// Stores annotation shapes drawn on an ACTIVE screen share so a viewer who
// joins mid-share can be caught up instead of seeing a blank overlay.
// Cleared whenever that screen share starts fresh or stops — annotations
// are still ephemeral to a single share session, this just extends
// "ephemeral" to cover "for the lifetime of one active share" instead of
// "only from the moment you personally happened to be watching."
const roomAnnotationHistory = new Map();
const MAX_ANNOTATION_HISTORY_PER_SCREEN = 300;

// roomId -> { open: boolean, shapes: Shape[] }
const roomWhiteboards = new Map();

// roomId -> ms epoch when the room was first created. Stamped ONCE by the
// server, at room-creation time, and handed to every joiner (existing and
// future) so every client's meeting timer counts from the exact same
// anchor point instead of each client's own local Date.now() at the
// moment THEY happened to join — which drifted from each other by
// however many seconds/minutes apart people actually joined.
const roomTimers = new Map();

function getRoomParticipants(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.entries()).map(([socketId, data]) => ({
    socketId,
    ...data,
  }));
}

function getScreenShareSet(roomId) {
  if (!roomScreenShares.has(roomId)) roomScreenShares.set(roomId, new Set());
  return roomScreenShares.get(roomId);
}

function getRoomSecurity(roomId) {
  if (!roomSecurity.has(roomId)) roomSecurity.set(roomId, { locked: false, password: '', waitingRoom: true });
  return roomSecurity.get(roomId);
}

function getWaitingRequestMap(roomId) {
  if (!roomWaitingRequests.has(roomId)) roomWaitingRequests.set(roomId, new Map());
  return roomWaitingRequests.get(roomId);
}

function isModerator(participant) {
  return Boolean(participant?.isHost || participant?.isCoHost);
}

// Lazily stamps a room's creation time on first access so this is safe to
// call defensively, but in practice it's set explicitly at the moment of
// creation in the join-room handler below.
function getRoomCreatedAt(roomId) {
  if (!roomTimers.has(roomId)) roomTimers.set(roomId, Date.now());
  return roomTimers.get(roomId);
}

function cleanupEmptyRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.size > 0) return false;

  rooms.delete(roomId);
  roomScreenShares.delete(roomId);
  roomAnnotationGrants.delete(roomId);
  roomAnnotationHistory.delete(roomId);
  roomSecurity.delete(roomId);
  roomWaitingRequests.delete(roomId);
  roomWhiteboards.delete(roomId);
  roomTimers.delete(roomId);
  return true;
}

function destroyRoom(roomId, reason = 'ended') {
  const socketIds = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
  io.to(roomId).emit('meeting-ended', { reason });
  socketIds.forEach((socketId) => {
    io.sockets.sockets.get(socketId)?.leave(roomId);
  });

  const waiting = roomWaitingRequests.get(roomId);
  if (waiting) {
    waiting.forEach((_, socketId) => {
      io.to(socketId).emit('waiting-room-denied', { reason: 'Meeting ended.' });
    });
  }

  rooms.delete(roomId);
  roomScreenShares.delete(roomId);
  roomAnnotationGrants.delete(roomId);
  roomAnnotationHistory.delete(roomId);
  roomSecurity.delete(roomId);
  roomWaitingRequests.delete(roomId);
  roomWhiteboards.delete(roomId);
  roomTimers.delete(roomId);
}

function getRoomWhiteboard(roomId) {
  if (!roomWhiteboards.has(roomId)) roomWhiteboards.set(roomId, { open: false, shapes: [] });
  return roomWhiteboards.get(roomId);
}

function buildAnnotationHistoryPayload(roomId, screenSharingSocketIds) {
  const annotationHistory = {};
  screenSharingSocketIds.forEach((screenOwnerId) => {
    const shapes = roomAnnotationHistory.get(roomId)?.get(screenOwnerId);
    if (shapes && shapes.length) annotationHistory[screenOwnerId] = shapes;
  });
  return annotationHistory;
}

function addParticipantToRoom(socket, { roomId, userName, isMuted = false, isVideoOff = false, isHost = false, isCoHost = false }) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  const room = rooms.get(roomId);

  socket.join(roomId);
  room.set(socket.id, {
    name: userName,
    isHost: Boolean(isHost),
    isCoHost: Boolean(isCoHost),
    isMuted: Boolean(isMuted),
    isVideoOff: Boolean(isVideoOff),
    handRaised: false,
    roomId,
  });

  const security = getRoomSecurity(roomId);
  const screenSharingSocketIds = Array.from(getScreenShareSet(roomId));
  const others = getRoomParticipants(roomId).filter((p) => p.socketId !== socket.id);

  socket.emit('room-joined', {
    socketId: socket.id,
    isHost: Boolean(isHost),
    isCoHost: Boolean(isCoHost),
    participants: others,
    screenSharingSocketIds,
    roomLocked: security.locked,
    passwordProtected: Boolean(security.password),
    waitingRoomEnabled: Boolean(security.waitingRoom),
    whiteboard: getRoomWhiteboard(roomId),
    roomCreatedAt: getRoomCreatedAt(roomId),
    annotationHistory: buildAnnotationHistoryPayload(roomId, screenSharingSocketIds),
  });

  socket.to(roomId).emit('user-joined', {
    socketId: socket.id,
    name: userName,
    isHost: Boolean(isHost),
    isCoHost: Boolean(isCoHost),
    isMuted: Boolean(isMuted),
    isVideoOff: Boolean(isVideoOff),
    handRaised: false,
  });
}

function emitWaitingRequests(roomId) {
  const requests = Array.from(getWaitingRequestMap(roomId).entries()).map(([socketId, data]) => ({
    socketId,
    name: data.userName,
    requestedAt: data.requestedAt,
  }));
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [socketId, participant] of room.entries()) {
    if (isModerator(participant)) {
      io.to(socketId).emit('waiting-room-list', { requests });
    }
  }
}

function getAnnotationGrantMap(roomId) {
  if (!roomAnnotationGrants.has(roomId)) roomAnnotationGrants.set(roomId, new Map());
  return roomAnnotationGrants.get(roomId);
}

function getAnnotationGrantSet(roomId, screenOwnerId) {
  const grants = getAnnotationGrantMap(roomId);
  if (!grants.has(screenOwnerId)) grants.set(screenOwnerId, new Set());
  return grants.get(screenOwnerId);
}

function getAnnotationHistoryMap(roomId) {
  if (!roomAnnotationHistory.has(roomId)) roomAnnotationHistory.set(roomId, new Map());
  return roomAnnotationHistory.get(roomId);
}

function getAnnotationHistoryList(roomId, screenOwnerId) {
  const history = getAnnotationHistoryMap(roomId);
  if (!history.has(screenOwnerId)) history.set(screenOwnerId, []);
  return history.get(screenOwnerId);
}

function clearAnnotationHistoryForScreen(roomId, screenOwnerId) {
  roomAnnotationHistory.get(roomId)?.delete(screenOwnerId);
}

function canAnnotate(roomId, screenOwnerId, socketId) {
  if (screenOwnerId === socketId) return roomScreenShares.get(roomId)?.has(screenOwnerId) === true;
  return roomAnnotationGrants.get(roomId)?.get(screenOwnerId)?.has(socketId) === true;
}

function clearAnnotationAccessForScreen(roomId, screenOwnerId) {
  const grants = roomAnnotationGrants.get(roomId);
  const grantedSocketIds = Array.from(grants?.get(screenOwnerId) || []);
  grants?.delete(screenOwnerId);
  grantedSocketIds.forEach((socketId) => {
    io.to(socketId).emit('annotation-access-updated', {
      screenOwnerId,
      granted: false,
    });
  });
  // Access and history always end together — once nobody can draw on a
  // screen (it stopped sharing, or is starting a brand new share), any
  // shapes drawn on the PREVIOUS session are no longer relevant to catch
  // late joiners up on.
  clearAnnotationHistoryForScreen(roomId, screenOwnerId);
}

function revokeSocketAnnotationAccess(roomId, socketId) {
  const grants = roomAnnotationGrants.get(roomId);
  if (!grants) return;
  for (const [screenOwnerId, grantedSocketIds] of grants.entries()) {
    if (grantedSocketIds.delete(socketId)) {
      io.to(screenOwnerId).emit('annotation-access-revoked', {
        screenOwnerId,
        socketId,
      });
    }
  }
}

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ─── JOIN ROOM ───────────────────────────────────────────────
  socket.on('join-room', ({ roomId, userName, isMuted = false, isVideoOff = false, password = '', createPassword = '' }) => {
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);
    const security = getRoomSecurity(roomId);
    const isFirstJoiner = room.size === 0;

    if (!isFirstJoiner) {
      if (security.locked) {
        socket.emit('room-locked');
        console.log(`[!] Room ${roomId} is locked, rejected ${userName}`);
        return;
      }

      if (security.password && security.password !== String(password || '')) {
        socket.emit('room-password-required', { invalid: Boolean(password) });
        console.log(`[!] Room ${roomId} requires password, rejected ${userName}`);
        return;
      }
    }

    // Enforce max participant limit
    if (room.size >= MAX_PARTICIPANTS) {
      socket.emit('room-full', { max: MAX_PARTICIPANTS });
      console.log(`[!] Room ${roomId} is full (${MAX_PARTICIPANTS}), rejected ${userName}`);
      return;
    }

    if (!isFirstJoiner && security.waitingRoom) {
      const waiting = getWaitingRequestMap(roomId);
      waiting.set(socket.id, {
        roomId,
        userName,
        isMuted: Boolean(isMuted),
        isVideoOff: Boolean(isVideoOff),
        requestedAt: new Date().toISOString(),
      });
      socket.data.waitingRoomId = roomId;
      socket.emit('waiting-room-pending', { roomId });
      emitWaitingRequests(roomId);
      console.log(`[~] ${userName} (${socket.id}) is waiting for admission to room ${roomId}`);
      return;
    }

    socket.join(roomId);
    const isHost = isFirstJoiner;
    if (isHost && createPassword) {
      security.password = String(createPassword).slice(0, 80);
    }
    if (isFirstJoiner) {
      roomTimers.set(roomId, Date.now());
    }

    room.set(socket.id, {
      name: userName,
      isHost,
      isCoHost: false,
      isMuted: Boolean(isMuted),
      isVideoOff: Boolean(isVideoOff),
      handRaised: false,
      roomId,
    });

    console.log(`[+] ${userName} (${socket.id}) joined room ${roomId} — Host: ${isHost}`);

    // Send existing participants to the new user
    const others = getRoomParticipants(roomId).filter(
      (p) => p.socketId !== socket.id
    );

    // Let the new joiner know who is already screen-sharing so they
    // can render placeholders / expect incoming screen offers.
    const screenSharingSocketIds = Array.from(getScreenShareSet(roomId));

    // Catch the new joiner up on shapes already drawn on any screen that's
    // CURRENTLY being shared, so they don't see a blank overlay while
    // everyone else sees the full annotation history. Only active shares
    // have history at all — it's cleared the moment a share stops (see
    // clearAnnotationAccessForScreen), so there's nothing stale to leak in.
    const annotationHistory = {};
    screenSharingSocketIds.forEach((screenOwnerId) => {
      const shapes = roomAnnotationHistory.get(roomId)?.get(screenOwnerId);
      if (shapes && shapes.length) annotationHistory[screenOwnerId] = shapes;
    });

    socket.emit('room-joined', {
      socketId: socket.id,
      isHost,
      participants: others,
      screenSharingSocketIds,
      roomLocked: security.locked,
      passwordProtected: Boolean(security.password),
      waitingRoomEnabled: Boolean(security.waitingRoom),
      whiteboard: getRoomWhiteboard(roomId),
      roomCreatedAt: getRoomCreatedAt(roomId),
      annotationHistory,
    });

    // Notify everyone else about the new user
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      name: userName,
      isHost,
      isCoHost: false,
      isMuted: Boolean(isMuted),
      isVideoOff: Boolean(isVideoOff),
      handRaised: false,
    });
  });

  // ─── WEBRTC SIGNALING ────────────────────────────────────────
  // `kind` distinguishes camera connections from screen-share connections
  // ('camera' | 'screen'). Undefined/omitted is treated as 'camera' by
  // the client for backwards compatibility.
  socket.on('offer', ({ to, offer, kind }) => {
    io.to(to).emit('offer', { from: socket.id, offer, kind });
  });

  socket.on('answer', ({ to, answer, kind }) => {
    io.to(to).emit('answer', { from: socket.id, answer, kind });
  });

  socket.on('ice-candidate', ({ to, candidate, kind }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate, kind });
  });

  // ─── MEDIA STATE UPDATES ─────────────────────────────────────
  socket.on('media-state', ({ roomId, isMuted, isVideoOff }) => {
    const room = rooms.get(roomId);
    if (room && room.has(socket.id)) {
      const participant = room.get(socket.id);
      room.set(socket.id, { ...participant, isMuted, isVideoOff });
    }
    socket.to(roomId).emit('peer-media-state', {
      socketId: socket.id,
      isMuted,
      isVideoOff,
    });
  });

  socket.on('hand-state', ({ roomId, raised }) => {
    const room = rooms.get(roomId);
    if (room && room.has(socket.id)) {
      const participant = room.get(socket.id);
      room.set(socket.id, { ...participant, handRaised: Boolean(raised) });
    }

    socket.to(roomId).emit('peer-hand-state', {
      socketId: socket.id,
      raised: Boolean(raised),
    });
  });

  // ─── SCREEN SHARE (max MAX_SCREEN_SHARES concurrent per room) ─
  socket.on('screen-share-started', ({ roomId }, callback) => {
    const shares = getScreenShareSet(roomId);

    // Already sharing (e.g. re-offer to a late joiner) — allow, no-op on the set.
    if (shares.has(socket.id)) {
      if (typeof callback === 'function') callback({ ok: true });
      return;
    }

    if (shares.size >= MAX_SCREEN_SHARES) {
      console.log(`[!] Screen share denied in ${roomId} — limit (${MAX_SCREEN_SHARES}) reached`);
      if (typeof callback === 'function') {
        callback({ ok: false, max: MAX_SCREEN_SHARES });
      }
      return;
    }

    // Defensive reset — a fresh share should never inherit access grants
    // or replay shapes from that same socket's earlier share this session,
    // even though the stop/disconnect paths already clear these. Cheap,
    // and avoids a race if this ever fires before a prior stop's cleanup lands.
    clearAnnotationAccessForScreen(roomId, socket.id);

    shares.add(socket.id);
    socket.to(roomId).emit('peer-screen-share', {
      socketId: socket.id,
      sharing: true,
    });
    console.log(`[+] ${socket.id} started screen share in ${roomId} (${shares.size}/${MAX_SCREEN_SHARES})`);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('screen-share-stopped', ({ roomId }) => {
    const shares = roomScreenShares.get(roomId);
    shares?.delete(socket.id);
    clearAnnotationAccessForScreen(roomId, socket.id);
    socket.to(roomId).emit('peer-screen-share', {
      socketId: socket.id,
      sharing: false,
    });
    console.log(`[-] ${socket.id} stopped screen share in ${roomId}`);
  });

  // ─── SCREEN ANNOTATION (sharer-only) ──────────────────────────
  // `screenOwnerId` must equal the emitting socket's own id — this is the
  // server-side enforcement of "only the person sharing their screen can
  // draw on it." The client already only mounts drawing controls for the
  // local sharer, but a client is untrusted, so we re-check here too.
  // A shape history IS kept per active share (see roomAnnotationHistory)
  // so late joiners can be caught up — this is separate from persistent
  // storage: the history only exists for the lifetime of one active share
  // and is thrown away the moment it stops or restarts.
  socket.on('annotation-request-access', ({ roomId, screenOwnerId }, callback) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    const owner = room?.get(screenOwnerId);
    const shares = roomScreenShares.get(roomId);

    if (!requester || !owner || !shares?.has(screenOwnerId) || screenOwnerId === socket.id) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    io.to(screenOwnerId).emit('annotation-access-requested', {
      screenOwnerId,
      requesterSocketId: socket.id,
      requesterName: requester.name || 'Participant',
    });

    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('room-lock-set', ({ roomId, locked }, callback) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!isModerator(requester)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    const security = getRoomSecurity(roomId);
    security.locked = Boolean(locked);
    io.to(roomId).emit('room-lock-updated', { locked: security.locked });
    if (typeof callback === 'function') callback({ ok: true, locked: security.locked });
  });

  socket.on('waiting-room-response', ({ roomId, requesterSocketId, approved }, callback) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!isModerator(requester)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    const waiting = getWaitingRequestMap(roomId);
    const pending = waiting.get(requesterSocketId);
    if (!pending) {
      if (typeof callback === 'function') callback({ ok: false });
      emitWaitingRequests(roomId);
      return;
    }

    waiting.delete(requesterSocketId);
    const target = io.sockets.sockets.get(requesterSocketId);

    if (!approved) {
      target?.emit('waiting-room-denied', { reason: 'The host denied your request to join.' });
      emitWaitingRequests(roomId);
      if (typeof callback === 'function') callback({ ok: true });
      return;
    }

    if (!target) {
      emitWaitingRequests(roomId);
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    if (room.size >= MAX_PARTICIPANTS) {
      target.emit('room-full', { max: MAX_PARTICIPANTS });
      emitWaitingRequests(roomId);
      if (typeof callback === 'function') callback({ ok: false, full: true });
      return;
    }

    delete target.data.waitingRoomId;
    addParticipantToRoom(target, pending);
    emitWaitingRequests(roomId);
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('cohost-set', ({ roomId, targetSocketId, isCoHost }, callback) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    const target = room?.get(targetSocketId);
    if (!requester?.isHost || !target || target.isHost) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    room.set(targetSocketId, { ...target, isCoHost: Boolean(isCoHost) });
    io.to(roomId).emit('participant-role-updated', {
      socketId: targetSocketId,
      isCoHost: Boolean(isCoHost),
    });
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('end-meeting', ({ roomId }, callback) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!isModerator(requester)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    destroyRoom(roomId, 'ended');
    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('annotation-access-response', ({ roomId, requesterSocketId, approved }, callback) => {
    const room = rooms.get(roomId);
    const shares = roomScreenShares.get(roomId);
    const requester = room?.get(requesterSocketId);

    if (!room?.has(socket.id) || !requester || !shares?.has(socket.id)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    const granted = Boolean(approved);
    const grantSet = getAnnotationGrantSet(roomId, socket.id);
    if (granted) grantSet.add(requesterSocketId);
    else grantSet.delete(requesterSocketId);

    io.to(requesterSocketId).emit('annotation-access-updated', {
      screenOwnerId: socket.id,
      granted,
    });
    io.to(socket.id).emit('annotation-access-grant-updated', {
      screenOwnerId: socket.id,
      socketId: requesterSocketId,
      name: requester.name || 'Participant',
      granted,
    });

    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('annotation-access-revoke', ({ roomId, screenOwnerId, targetSocketId }, callback) => {
    const room = rooms.get(roomId);
    const shares = roomScreenShares.get(roomId);
    if (screenOwnerId !== socket.id || !room?.has(targetSocketId) || !shares?.has(socket.id)) {
      if (typeof callback === 'function') callback({ ok: false });
      return;
    }

    getAnnotationGrantMap(roomId).get(screenOwnerId)?.delete(targetSocketId);
    io.to(targetSocketId).emit('annotation-access-updated', {
      screenOwnerId,
      granted: false,
    });
    io.to(socket.id).emit('annotation-access-grant-updated', {
      screenOwnerId,
      socketId: targetSocketId,
      granted: false,
    });

    if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('annotation-draw', ({ roomId, screenOwnerId, shape }) => {
    if (!canAnnotate(roomId, screenOwnerId, socket.id)) return;
    if (shape && typeof shape === 'object') {
      const history = getAnnotationHistoryList(roomId, screenOwnerId);
      history.push(shape);
      // Cap so a very long/abusive session can't grow this unbounded —
      // oldest strokes roll off first, same tradeoff a live viewer already
      // implicitly accepts (they wouldn't have seen those either).
      if (history.length > MAX_ANNOTATION_HISTORY_PER_SCREEN) {
        history.splice(0, history.length - MAX_ANNOTATION_HISTORY_PER_SCREEN);
      }
    }
    socket.to(roomId).emit('annotation-draw', { screenOwnerId, shape });
  });

  socket.on('annotation-undo', ({ roomId, screenOwnerId, shapeId }) => {
    if (!canAnnotate(roomId, screenOwnerId, socket.id)) return;
    const history = roomAnnotationHistory.get(roomId)?.get(screenOwnerId);
    if (history) {
      const index = history.findIndex((s) => s.id === shapeId);
      if (index !== -1) history.splice(index, 1);
    }
    socket.to(roomId).emit('annotation-undo', { screenOwnerId, shapeId });
  });

  socket.on('annotation-clear', ({ roomId, screenOwnerId }) => {
    if (!canAnnotate(roomId, screenOwnerId, socket.id)) return;
    roomAnnotationHistory.get(roomId)?.set(screenOwnerId, []);
    socket.to(roomId).emit('annotation-clear', { screenOwnerId });
  });

  // ─── WHITEBOARD ──────────────────────────────────────────────
  socket.on('whiteboard-open-set', ({ roomId, open }) => {
    const room = rooms.get(roomId);
    if (!room?.has(socket.id)) return;
    const whiteboard = getRoomWhiteboard(roomId);
    whiteboard.open = Boolean(open);
    io.to(roomId).emit('whiteboard-open-updated', { open: whiteboard.open });
  });

  socket.on('whiteboard-draw', ({ roomId, shape }) => {
    const room = rooms.get(roomId);
    if (!room?.has(socket.id) || !shape?.id) return;
    const whiteboard = getRoomWhiteboard(roomId);
    whiteboard.shapes.push(shape);
    socket.to(roomId).emit('whiteboard-draw', { shape });
  });

  socket.on('whiteboard-undo', ({ roomId, shapeId }) => {
    const room = rooms.get(roomId);
    if (!room?.has(socket.id)) return;
    const whiteboard = getRoomWhiteboard(roomId);
    whiteboard.shapes = whiteboard.shapes.filter((shape) => shape.id !== shapeId);
    socket.to(roomId).emit('whiteboard-undo', { shapeId });
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room?.has(socket.id)) return;
    const whiteboard = getRoomWhiteboard(roomId);
    whiteboard.shapes = [];
    socket.to(roomId).emit('whiteboard-clear');
  });

  // ─── CHAT ────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, message, file, replyTo }) => {
    const room = rooms.get(roomId);
    const participant = room?.get(socket.id);
    if (!participant) return;

    const safeMessage = String(message || '').trim().slice(0, 2000);
    let safeFile = null;
    if (
      file &&
      typeof file.name === 'string' &&
      typeof file.dataUrl === 'string' &&
      Number(file.size) > 0 &&
      Number(file.size) <= MAX_CHAT_FILE_BYTES &&
      file.dataUrl.length <= Math.ceil(MAX_CHAT_FILE_BYTES * 1.45)
    ) {
      safeFile = {
        name: file.name.slice(0, 120),
        type: String(file.type || 'application/octet-stream').slice(0, 120),
        size: Number(file.size),
        dataUrl: file.dataUrl,
      };
    }

    if (!safeMessage && !safeFile) return;

    const payload = {
      id: `${socket.id}-${Date.now()}`,
      from: socket.id,
      name: participant.name || 'Unknown',
      message: safeMessage,
      file: safeFile,
      replyTo: replyTo
        ? {
          id: String(replyTo.id || '').slice(0, 160),
          name: String(replyTo.name || 'Participant').slice(0, 80),
          message: String(replyTo.message || '').slice(0, 180),
          fileName: String(replyTo.fileName || '').slice(0, 120),
        }
        : null,
      reactions: {},
      timestamp: new Date().toISOString(),
    };
    io.to(roomId).emit('chat-message', payload);
  });

  socket.on('chat-reaction', ({ roomId, messageId, reaction }) => {
    const room = rooms.get(roomId);
    const participant = room?.get(socket.id);
    if (!participant) return;

    const safeReaction = String(reaction || '').slice(0, 20);
    if (!['Like', 'Love', 'Laugh'].includes(safeReaction)) return;

    io.to(roomId).emit('chat-reaction', {
      messageId: String(messageId || '').slice(0, 160),
      reaction: safeReaction,
      socketId: socket.id,
      name: participant.name || 'Participant',
    });
  });

  // ─── LIVE CAPTIONS (Web Speech API, client-side transcription) ─
  // The server never sees or stores audio — each client runs its own
  // browser's SpeechRecognition on its own mic and relays only the
  // resulting text. This just fans that text out to the rest of the
  // room, same shape as chat relay. Nothing is persisted.
  socket.on('caption-text', ({ roomId, text, isFinal }) => {
    const room = rooms.get(roomId);
    const participant = room?.get(socket.id);
    if (!participant) return;

    const safeText = String(text || '').trim().slice(0, 500);
    if (!safeText) return;

    socket.to(roomId).emit('caption-text', {
      socketId: socket.id,
      name: participant.name || 'Participant',
      text: safeText,
      isFinal: Boolean(isFinal),
    });
  });

  // ─── HOST CONTROLS ───────────────────────────────────────────
  socket.on('mute-all', ({ roomId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!isModerator(requester)) return;
    socket.to(roomId).emit('host-mute-all');
  });

  socket.on('mute-user', ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!isModerator(requester) || !room?.has(targetSocketId)) return;
    io.to(targetSocketId).emit('host-mute-user');
  });

  socket.on('remove-user', ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!isModerator(requester)) return;
    const targetParticipant = room?.get(targetSocketId);
    if (!targetParticipant || (targetParticipant.isHost && !requester.isHost)) return;
    io.to(targetSocketId).emit('removed-from-room');
    const target = io.sockets.sockets.get(targetSocketId);
    if (target) {
      target.leave(roomId);
      room?.delete(targetSocketId);
      roomScreenShares.get(roomId)?.delete(targetSocketId);
      clearAnnotationAccessForScreen(roomId, targetSocketId);
      revokeSocketAnnotationAccess(roomId, targetSocketId);
      io.to(roomId).emit('user-left', { socketId: targetSocketId });
      cleanupEmptyRoom(roomId);
    }
  });

  // ─── DISCONNECT ──────────────────────────────────────────────
  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      const room = rooms.get(roomId);
      if (!room) continue;

      // Release this socket's screen-share slot, if any, and notify peers.
      const shares = roomScreenShares.get(roomId);
      if (shares?.has(socket.id)) {
        shares.delete(socket.id);
        clearAnnotationAccessForScreen(roomId, socket.id);
        socket.to(roomId).emit('peer-screen-share', { socketId: socket.id, sharing: false });
      }
      revokeSocketAnnotationAccess(roomId, socket.id);

      const leaving = room.get(socket.id);
      room.delete(socket.id);

      if (!cleanupEmptyRoom(roomId) && leaving?.isHost) {
        // Transfer host to next participant
        const preferredHost = Array.from(room.entries()).find(([, data]) => data.isCoHost)
          || room.entries().next().value;
        const [newHostId, newHostData] = preferredHost;
        room.set(newHostId, { ...newHostData, isHost: true, isCoHost: false });
        io.to(roomId).emit('host-transferred', { socketId: newHostId });
      }

      socket.to(roomId).emit('user-left', { socketId: socket.id });
      console.log(`[-] ${leaving?.name || socket.id} left room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    const waitingRoomId = socket.data.waitingRoomId;
    if (waitingRoomId) {
      getWaitingRequestMap(waitingRoomId).delete(socket.id);
      emitWaitingRequests(waitingRoomId);
      cleanupEmptyRoom(waitingRoomId);
    }
    console.log(`[-] Socket disconnected: ${socket.id}`);
  });
});

// ─── REST ────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('/room/:roomId/info', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.json({ exists: false, count: 0 });
  const shares = roomScreenShares.get(req.params.roomId);
  res.json({
    exists: true,
    count: room.size,
    screenSharesActive: shares ? shares.size : 0,
    maxScreenShares: MAX_SCREEN_SHARES,
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
});
