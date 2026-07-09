const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// roomId -> Map<socketId, { name, isHost, isMuted, isVideoOff, handRaised }>
const rooms = new Map();
const MAX_PARTICIPANTS = 6;
const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

// roomId -> Set<socketId> currently screen-sharing
const roomScreenShares = new Map();
const MAX_SCREEN_SHARES = 2;

// roomId -> Map<screenOwnerId, Set<grantedSocketId>>
const roomAnnotationGrants = new Map();

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

function getAnnotationGrantMap(roomId) {
  if (!roomAnnotationGrants.has(roomId)) roomAnnotationGrants.set(roomId, new Map());
  return roomAnnotationGrants.get(roomId);
}

function getAnnotationGrantSet(roomId, screenOwnerId) {
  const grants = getAnnotationGrantMap(roomId);
  if (!grants.has(screenOwnerId)) grants.set(screenOwnerId, new Set());
  return grants.get(screenOwnerId);
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
  socket.on('join-room', ({ roomId, userName, isMuted = false, isVideoOff = false }) => {
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Enforce max participant limit
    if (room.size >= MAX_PARTICIPANTS) {
      socket.emit('room-full', { max: MAX_PARTICIPANTS });
      console.log(`[!] Room ${roomId} is full (${MAX_PARTICIPANTS}), rejected ${userName}`);
      return;
    }

    socket.join(roomId);
    const isHost = room.size === 0;

    room.set(socket.id, {
      name: userName,
      isHost,
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

    socket.emit('room-joined', {
      socketId: socket.id,
      isHost,
      participants: others,
      screenSharingSocketIds,
    });

    // Notify everyone else about the new user
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      name: userName,
      isHost,
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
  // No server-side shape history is kept: annotations are relayed live and
  // are not replayed for participants who join mid-share.
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
    socket.to(roomId).emit('annotation-draw', { screenOwnerId, shape });
  });

  socket.on('annotation-undo', ({ roomId, screenOwnerId, shapeId }) => {
    if (!canAnnotate(roomId, screenOwnerId, socket.id)) return;
    socket.to(roomId).emit('annotation-undo', { screenOwnerId, shapeId });
  });

  socket.on('annotation-clear', ({ roomId, screenOwnerId }) => {
    if (!canAnnotate(roomId, screenOwnerId, socket.id)) return;
    socket.to(roomId).emit('annotation-clear', { screenOwnerId });
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
    if (!['+1', 'Heart', 'Ha'].includes(safeReaction)) return;

    io.to(roomId).emit('chat-reaction', {
      messageId: String(messageId || '').slice(0, 160),
      reaction: safeReaction,
      socketId: socket.id,
      name: participant.name || 'Participant',
    });
  });

  // ─── HOST CONTROLS ───────────────────────────────────────────
  socket.on('mute-all', ({ roomId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!requester?.isHost) return;
    socket.to(roomId).emit('host-mute-all');
  });

  socket.on('mute-user', ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!requester?.isHost || !room?.has(targetSocketId)) return;
    io.to(targetSocketId).emit('host-mute-user');
  });

  socket.on('remove-user', ({ roomId, targetSocketId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!requester?.isHost) return;
    io.to(targetSocketId).emit('removed-from-room');
    const target = io.sockets.sockets.get(targetSocketId);
    if (target) {
      target.leave(roomId);
      room?.delete(targetSocketId);
      roomScreenShares.get(roomId)?.delete(targetSocketId);
      clearAnnotationAccessForScreen(roomId, targetSocketId);
      revokeSocketAnnotationAccess(roomId, targetSocketId);
      io.to(roomId).emit('user-left', { socketId: targetSocketId });
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

      if (room.size === 0) {
        rooms.delete(roomId);
        roomScreenShares.delete(roomId);
        roomAnnotationGrants.delete(roomId);
      } else if (leaving?.isHost) {
        // Transfer host to next participant
        const [newHostId, newHostData] = room.entries().next().value;
        room.set(newHostId, { ...newHostData, isHost: true });
        io.to(roomId).emit('host-transferred', { socketId: newHostId });
      }

      socket.to(roomId).emit('user-left', { socketId: socket.id });
      console.log(`[-] ${leaving?.name || socket.id} left room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
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
