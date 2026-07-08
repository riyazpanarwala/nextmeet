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

// roomId -> Map<socketId, { name, isHost, isMuted, isVideoOff }>
const rooms = new Map();
const MAX_PARTICIPANTS = 6;

// roomId -> Set<socketId> currently screen-sharing
const roomScreenShares = new Map();
const MAX_SCREEN_SHARES = 2;

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
    socket.to(roomId).emit('peer-screen-share', {
      socketId: socket.id,
      sharing: false,
    });
    console.log(`[-] ${socket.id} stopped screen share in ${roomId}`);
  });

  // ─── CHAT ────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    const participant = room?.get(socket.id);
    const payload = {
      id: `${socket.id}-${Date.now()}`,
      from: socket.id,
      name: participant?.name || 'Unknown',
      message,
      timestamp: new Date().toISOString(),
    };
    io.to(roomId).emit('chat-message', payload);
  });

  // ─── HOST CONTROLS ───────────────────────────────────────────
  socket.on('mute-all', ({ roomId }) => {
    const room = rooms.get(roomId);
    const requester = room?.get(socket.id);
    if (!requester?.isHost) return;
    socket.to(roomId).emit('host-mute-all');
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
        socket.to(roomId).emit('peer-screen-share', { socketId: socket.id, sharing: false });
      }

      const leaving = room.get(socket.id);
      room.delete(socket.id);

      if (room.size === 0) {
        rooms.delete(roomId);
        roomScreenShares.delete(roomId);
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
