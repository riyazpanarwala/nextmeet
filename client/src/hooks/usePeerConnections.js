import { useRef, useCallback } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Add TURN for production (needed behind symmetric NAT):
  // { urls: 'turn:your-server:3478', username: 'user', credential: 'pass' },
];

const CAMERA_VIDEO_ENCODING = {
  maxBitrate: 700_000,
  maxFramerate: 24,
};

const SCREEN_VIDEO_ENCODING = {
  maxBitrate: 1_500_000,
  maxFramerate: 15,
};

async function applySenderEncoding(sender, encoding) {
  if (!sender?.track || sender.track.kind !== 'video') return;

  try {
    const params = sender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0] = {
      ...params.encodings[0],
      ...encoding,
    };
    await sender.setParameters(params);
  } catch (err) {
    console.warn('[PC] Could not apply sender encoding constraints:', err);
  }
}

export function usePeerConnections({
  socket,
  localStreamRef,
  onRemoteStream,
  onPeerLeft,
  onRemoteScreenStream,
  onScreenPeerLeft,
}) {
  // socketId -> RTCPeerConnection (camera/mic)
  const peerConnections = useRef({});
  // socketId -> RTCIceCandidate[] (queued before remoteDescription is set)
  const iceCandidateQueues = useRef({});
  // socketId -> persistent MediaStream we build ourselves from incoming
  // tracks. We do NOT rely on the browser's `streams[0]` identity from
  // ontrack staying consistent across the audio-track event and the
  // video-track event — some mobile Safari/WebKit builds report a
  // different stream object per track in certain negotiation orders,
  // which silently overwrote the video-bearing stream with an
  // audio-only one (camera appeared to "go missing"). Owning the
  // MediaStream ourselves and just adding tracks to it sidesteps that
  // entirely, regardless of what the browser hands back.
  const remoteStreams = useRef({});

  // ══════════════════════════════════════════════════════════════
  // SCREEN-SHARE PEER CONNECTIONS — direction-aware.
  //
  // A single remoteSocketId can simultaneously be:
  //   - the target of a PC I created to SEND my screen to them, and
  //   - the source of a separate PC I created to RECEIVE their screen.
  //
  // These must live in two SEPARATE maps keyed by remoteSocketId.
  // Sharing one map keyed only by remoteSocketId (the old approach)
  // meant that whichever direction was created first "won" — later
  // calls for the opposite direction would silently reuse that PC
  // instead of creating their own, dropping tracks/offers on the floor
  // and corrupting the connection that was already working. This is
  // exactly what caused: (a) a second user's screen share never
  // reaching the first user, and (b) the first user's already-working
  // share appearing frozen once the second user started sharing.
  // ══════════════════════════════════════════════════════════════
  const outgoingScreenPCs = useRef({});        // remoteSocketId -> PC (I am the sender)
  const incomingScreenPCs = useRef({});        // remoteSocketId -> PC (I am the receiver)
  const outgoingScreenIceQueues = useRef({});
  const incomingScreenIceQueues = useRef({});
  const remoteScreenStreams = useRef({});       // only ever populated for incoming PCs

  const getOrCreateStream = useCallback((map, remoteSocketId) => {
    if (!map.current[remoteSocketId]) {
      map.current[remoteSocketId] = new MediaStream();
    }
    return map.current[remoteSocketId];
  }, []);

  // Add `track` to `stream`, replacing any existing track of the same
  // kind first. Safe to call multiple times for the same track (e.g. if
  // ontrack somehow fires twice) — it's a no-op the second time.
  const upsertTrack = useCallback((stream, track) => {
    stream.getTracks()
      .filter((t) => t.kind === track.kind && t !== track)
      .forEach((t) => stream.removeTrack(t));
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track);
    }
    track.onended = () => {
      if (stream.getTracks().includes(track)) stream.removeTrack(track);
    };
  }, []);

  // ══════════════════════════════════════════════════════════════
  // CAMERA / MIC PEER CONNECTIONS
  // ══════════════════════════════════════════════════════════════

  const createPeerConnection = useCallback(
    (remoteSocketId) => {
      if (peerConnections.current[remoteSocketId]) {
        return peerConnections.current[remoteSocketId];
      }

      console.log('[PC] Creating peer connection for:', remoteSocketId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      iceCandidateQueues.current[remoteSocketId] = [];

      // Gates onnegotiationneeded so it only fires *after* the initial
      // offer/answer handshake for this peer has completed. Without this,
      // the automatic negotiationneeded event fired by addTrack() below
      // would race with the explicit makeOffer()/handleOffer() flow below
      // and send a duplicate/premature offer before the first one settles.
      pc._negotiationReady = false;
      pc._makingOffer = false;

      // ── Add ALL local tracks so remote side receives both audio AND video ──
      const stream = localStreamRef.current;
      if (stream) {
        const tracks = stream.getTracks();
        console.log('[PC] Adding local tracks:', tracks.map((t) => t.kind));
        tracks.forEach((track) => {
          const sender = pc.addTrack(track, stream);
          if (track.kind === 'video') {
            void applySenderEncoding(sender, CAMERA_VIDEO_ENCODING);
          }
        });
      } else {
        console.warn('[PC] No local stream available when creating PC for', remoteSocketId);
      }

      // ── ICE candidate trickle ──
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socket.emit('ice-candidate', { to: remoteSocketId, candidate, kind: 'camera' });
        }
      };

      pc.onicegatheringstatechange = () => {
        console.log('[PC] ICE gathering state:', pc.iceGatheringState, 'for', remoteSocketId);
      };

      // ── Renegotiation ──
      // This is what actually makes pc.restartIce() (below) do something.
      // restartIce() only flags the connection as needing a new ICE
      // exchange — it's onnegotiationneeded that has to fire a fresh
      // createOffer()/setLocalDescription()/signal cycle for the restart
      // to take effect. WebRTC allows offer/answer roles to switch on
      // later negotiation rounds of the same connection, so it's fine for
      // either side (original offerer or original answerer) to send this.
      pc.onnegotiationneeded = async () => {
        if (!pc._negotiationReady) return;
        if (pc._makingOffer || pc.signalingState !== 'stable') return;
        try {
          pc._makingOffer = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log('[PC] Sending renegotiation offer to:', remoteSocketId);
          socket.emit('offer', { to: remoteSocketId, offer: pc.localDescription, kind: 'camera' });
        } catch (err) {
          console.error('[PC] onnegotiationneeded error:', err);
        } finally {
          pc._makingOffer = false;
        }
      };

      // ── Connection state ──
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('[PC] Connection state:', state, 'for', remoteSocketId);
        if (state === 'failed') {
          console.warn('[PC] Connection failed, attempting ICE restart');
          pc.restartIce();
        }
        if (state === 'disconnected' || state === 'closed') {
          onPeerLeft(remoteSocketId);
        }
      };

      pc.onsignalingstatechange = () => {
        console.log('[PC] Signaling state:', pc.signalingState, 'for', remoteSocketId);
      };

      // ── Remote tracks arriving ──
      // ontrack fires once per track (once for audio, once for video).
      // We deliberately IGNORE the browser-provided `streams[0]` for
      // identity purposes and instead maintain our own persistent
      // MediaStream per remote peer, adding each incoming track to it.
      // This guarantees the audio and video tracks always end up on the
      // SAME stream object we hand to the UI, even on browsers/devices
      // that report inconsistent stream identities across track events.
      pc.ontrack = ({ track }) => {
        console.log('[PC] Got remote track:', track.kind, 'from', remoteSocketId);
        const remoteStream = getOrCreateStream(remoteStreams, remoteSocketId);
        upsertTrack(remoteStream, track);
        onRemoteStream(remoteSocketId, remoteStream);
      };

      peerConnections.current[remoteSocketId] = pc;
      return pc;
    },
    [socket, localStreamRef, onRemoteStream, onPeerLeft, getOrCreateStream, upsertTrack]
  );

  // Drain any ICE candidates that arrived before remoteDescription was set
  const drainIceCandidateQueue = useCallback(async (remoteSocketId) => {
    const pc = peerConnections.current[remoteSocketId];
    const queue = iceCandidateQueues.current[remoteSocketId] || [];
    if (!pc || queue.length === 0) return;

    console.log('[PC] Draining', queue.length, 'queued ICE candidates for', remoteSocketId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[PC] Failed to add queued ICE candidate:', err);
      }
    }
    iceCandidateQueues.current[remoteSocketId] = [];
  }, []);

  // Called by the NEW joiner — sends offer to an existing participant
  const makeOffer = useCallback(
    async (remoteSocketId) => {
      const pc = createPeerConnection(remoteSocketId);
      try {
        pc._makingOffer = true;
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        pc._negotiationReady = true;
        console.log('[PC] Sending offer to:', remoteSocketId);
        socket.emit('offer', { to: remoteSocketId, offer: pc.localDescription, kind: 'camera' });
      } catch (err) {
        console.error('[PC] makeOffer error:', err);
      } finally {
        pc._makingOffer = false;
      }
    },
    [createPeerConnection, socket]
  );

  // Called on the existing user when a new joiner sends an offer
  const handleOffer = useCallback(
    async (remoteSocketId, offer) => {
      const pc = createPeerConnection(remoteSocketId);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        // Drain candidates that arrived before the offer was processed
        await drainIceCandidateQueue(remoteSocketId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        pc._negotiationReady = true;
        console.log('[PC] Sending answer to:', remoteSocketId);
        socket.emit('answer', { to: remoteSocketId, answer: pc.localDescription, kind: 'camera' });
      } catch (err) {
        console.error('[PC] handleOffer error:', err);
      }
    },
    [createPeerConnection, drainIceCandidateQueue, socket]
  );

  const handleAnswer = useCallback(async (remoteSocketId, answer) => {
    const pc = peerConnections.current[remoteSocketId];
    if (!pc) {
      console.warn('[PC] handleAnswer: no PC for', remoteSocketId);
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      pc._negotiationReady = true;
      pc._makingOffer = false;
      // Drain candidates that arrived before the answer
      await drainIceCandidateQueue(remoteSocketId);
    } catch (err) {
      console.error('[PC] handleAnswer error:', err);
    }
  }, [drainIceCandidateQueue]);

  const handleIceCandidate = useCallback(async (remoteSocketId, candidate) => {
    const pc = peerConnections.current[remoteSocketId];
    if (!pc) {
      console.warn('[PC] handleIceCandidate: no PC for', remoteSocketId);
      return;
    }

    const rtcCandidate = new RTCIceCandidate(candidate);

    // If remoteDescription not yet set, queue the candidate
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      console.log('[PC] Queuing ICE candidate for', remoteSocketId, '(no remoteDescription yet)');
      iceCandidateQueues.current[remoteSocketId] =
        iceCandidateQueues.current[remoteSocketId] || [];
      iceCandidateQueues.current[remoteSocketId].push(rtcCandidate);
      return;
    }

    try {
      await pc.addIceCandidate(rtcCandidate);
    } catch (err) {
      console.warn('[PC] addIceCandidate error:', err);
    }
  }, []);

  const closePeer = useCallback((remoteSocketId) => {
    const pc = peerConnections.current[remoteSocketId];
    if (pc) {
      pc.close();
      delete peerConnections.current[remoteSocketId];
      delete iceCandidateQueues.current[remoteSocketId];
      delete remoteStreams.current[remoteSocketId];
    }
  }, []);

  const closeAll = useCallback(() => {
    Object.keys(peerConnections.current).forEach(closePeer);
  }, [closePeer]);

  const replaceTrack = useCallback(async (oldTrack, newTrack) => {
    const kind = oldTrack?.kind || newTrack?.kind;
    if (!kind) return;
    const promises = Object.values(peerConnections.current).map(async (pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind)
        || pc.getTransceivers?.().find((t) =>
          t.sender && (t.sender.track?.kind === kind || t.receiver?.track?.kind === kind)
        )?.sender;
      if (!sender) return;
      await sender.replaceTrack(newTrack);
      if (newTrack?.kind === 'video') {
        await applySenderEncoding(sender, CAMERA_VIDEO_ENCODING);
      }
    });
    await Promise.all(promises);
  }, []);

  // ══════════════════════════════════════════════════════════════
  // SCREEN-SHARE PEER CONNECTIONS (direction-aware)
  //
  // Each screen share gets its own RTCPeerConnection per remote peer,
  // and — critically — a separate PC exists per DIRECTION. The SHARER
  // creates a send-only PC per viewer, stored in outgoingScreenPCs.
  // Viewers create a receive-only PC on offer, stored in
  // incomingScreenPCs. A single remoteSocketId may have an entry in
  // BOTH maps at once (mutual screen sharing) without conflict.
  //
  // This keeps the camera PC fully untouched — the sharer's own
  // camera tile never disappears — and avoids needing renegotiation/
  // mid-tracking on the camera connection.
  // ══════════════════════════════════════════════════════════════

  const createScreenPeerConnection = useCallback(
    (remoteSocketId, isSender, screenStream) => {
      const map = isSender ? outgoingScreenPCs : incomingScreenPCs;
      const queueMap = isSender ? outgoingScreenIceQueues : incomingScreenIceQueues;

      if (map.current[remoteSocketId]) {
        return map.current[remoteSocketId];
      }

      console.log(
        '[ScreenPC] Creating', isSender ? 'OUTGOING' : 'INCOMING',
        'screen peer connection for:', remoteSocketId
      );
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      queueMap.current[remoteSocketId] = [];
      pc._negotiationReady = false;
      pc._makingOffer = false;
      pc._isSender = isSender; // handy for debugging

      // Add every track from the screen stream — video AND audio (tab/
      // system audio, when the browser/user grants it) — not just video.
      if (isSender && screenStream) {
        screenStream.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, screenStream);
          if (track.kind === 'video') {
            void applySenderEncoding(sender, SCREEN_VIDEO_ENCODING);
          }
        });
      }

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socket.emit('ice-candidate', { to: remoteSocketId, candidate, kind: 'screen' });
        }
      };

      // Same renegotiation gate/logic as the camera PC — makes ICE
      // restarts on screen-share connections actually take effect.
      pc.onnegotiationneeded = async () => {
        if (!pc._negotiationReady) return;
        if (pc._makingOffer || pc.signalingState !== 'stable') return;
        try {
          pc._makingOffer = true;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log('[ScreenPC] Sending renegotiation offer to:', remoteSocketId);
          socket.emit('offer', { to: remoteSocketId, offer: pc.localDescription, kind: 'screen' });
        } catch (err) {
          console.error('[ScreenPC] onnegotiationneeded error:', err);
        } finally {
          pc._makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('[ScreenPC]', isSender ? 'OUTGOING' : 'INCOMING', 'connection state:', state, 'for', remoteSocketId);
        if (state === 'failed') {
          pc.restartIce();
        }
        if (state === 'disconnected' || state === 'closed') {
          // Only the incoming leg's death should clear the viewer's tile —
          // losing our outgoing leg doesn't mean their incoming share (if
          // they're also sharing to us) died too.
          if (!isSender) onScreenPeerLeft?.(remoteSocketId);
        }
      };

      // Same persistent-stream approach as the camera PC — don't trust
      // the browser's streams[0] identity across the separate video/audio
      // ontrack events. Only relevant for the receiving side.
      if (!isSender) {
        pc.ontrack = ({ track }) => {
          console.log('[ScreenPC] Got remote screen track from', remoteSocketId, track.kind);
          const remoteStream = getOrCreateStream(remoteScreenStreams, remoteSocketId);
          upsertTrack(remoteStream, track);
          onRemoteScreenStream(remoteSocketId, remoteStream);
        };
      }

      map.current[remoteSocketId] = pc;
      return pc;
    },
    [socket, onRemoteScreenStream, onScreenPeerLeft, getOrCreateStream, upsertTrack]
  );

  const drainScreenIceQueue = useCallback(async (map, queueMap, remoteSocketId) => {
    const pc = map.current[remoteSocketId];
    const queue = queueMap.current[remoteSocketId] || [];
    if (!pc || queue.length === 0) return;

    console.log('[ScreenPC] Draining', queue.length, 'queued ICE candidates for', remoteSocketId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[ScreenPC] Failed to add queued ICE candidate:', err);
      }
    }
    queueMap.current[remoteSocketId] = [];
  }, []);

  // Called by the SHARER for each remote participant (existing + late joiners).
  // `screenStream` is the FULL MediaStream from getDisplayMedia (video + audio).
  // Always creates/uses the OUTGOING-direction PC for remoteSocketId.
  const makeScreenOffer = useCallback(
    async (remoteSocketId, screenStream) => {
      const pc = createScreenPeerConnection(remoteSocketId, true, screenStream);
      try {
        pc._makingOffer = true;
        const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
        await pc.setLocalDescription(offer);
        pc._negotiationReady = true;
        console.log('[ScreenPC] Sending screen offer to:', remoteSocketId);
        socket.emit('offer', { to: remoteSocketId, offer: pc.localDescription, kind: 'screen' });
      } catch (err) {
        console.error('[ScreenPC] makeScreenOffer error:', err);
      } finally {
        pc._makingOffer = false;
      }
    },
    [createScreenPeerConnection, socket]
  );

  // Called by VIEWERS when a screen-share offer arrives. Always creates/uses
  // the INCOMING-direction PC for remoteSocketId — completely independent of
  // any OUTGOING PC we might also have open to that same remoteSocketId
  // (e.g. if we're also sharing our screen back to them).
  const handleScreenOffer = useCallback(
    async (remoteSocketId, offer) => {
      const pc = createScreenPeerConnection(remoteSocketId, false);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainScreenIceQueue(incomingScreenPCs, incomingScreenIceQueues, remoteSocketId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        pc._negotiationReady = true;
        console.log('[ScreenPC] Sending screen answer to:', remoteSocketId);
        socket.emit('answer', { to: remoteSocketId, answer: pc.localDescription, kind: 'screen' });
      } catch (err) {
        console.error('[ScreenPC] handleScreenOffer error:', err);
      }
    },
    [createScreenPeerConnection, drainScreenIceQueue, socket]
  );

  // An answer only ever responds to an offer WE sent — i.e. it always
  // targets our OUTGOING PC to that peer, never the incoming one.
  const handleScreenAnswer = useCallback(async (remoteSocketId, answer) => {
    const pc = outgoingScreenPCs.current[remoteSocketId];
    if (!pc) {
      console.warn('[ScreenPC] handleScreenAnswer: no outgoing PC for', remoteSocketId);
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      pc._negotiationReady = true;
      pc._makingOffer = false;
      await drainScreenIceQueue(outgoingScreenPCs, outgoingScreenIceQueues, remoteSocketId);
    } catch (err) {
      console.error('[ScreenPC] handleScreenAnswer error:', err);
    }
  }, [drainScreenIceQueue]);

  // ICE candidates don't self-identify which direction's PC they belong
  // to, and it's valid for BOTH an outgoing and incoming PC to the same
  // remoteSocketId to exist simultaneously (mutual screen sharing), so
  // apply/queue the candidate against whichever PC(s) actually exist for
  // that socket.
  const handleScreenIceCandidate = useCallback(async (remoteSocketId, candidate) => {
    const rtcCandidate = new RTCIceCandidate(candidate);
    const targets = [
      [outgoingScreenPCs, outgoingScreenIceQueues],
      [incomingScreenPCs, incomingScreenIceQueues],
    ];

    let appliedToAny = false;
    for (const [map, queueMap] of targets) {
      const pc = map.current[remoteSocketId];
      if (!pc) continue;
      appliedToAny = true;
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        queueMap.current[remoteSocketId] = queueMap.current[remoteSocketId] || [];
        queueMap.current[remoteSocketId].push(rtcCandidate);
      } else {
        try {
          await pc.addIceCandidate(rtcCandidate);
        } catch (err) {
          // Can happen when a candidate intended for the *other*
          // direction's PC is tried here first — not fatal, the other
          // map entry (if any) will pick it up.
        }
      }
    }
    if (!appliedToAny) {
      console.warn('[ScreenPC] handleScreenIceCandidate: no PC (in or out) for', remoteSocketId);
    }
  }, []);

  // Close only the leg where WE are sending our screen to remoteSocketId.
  // Use this when the LOCAL user stops sharing — any share we're still
  // receiving FROM that peer must be left untouched.
  const closeOutgoingScreenPeer = useCallback((remoteSocketId) => {
    const pc = outgoingScreenPCs.current[remoteSocketId];
    if (pc) {
      pc.close();
      delete outgoingScreenPCs.current[remoteSocketId];
      delete outgoingScreenIceQueues.current[remoteSocketId];
    }
  }, []);

  // Close only the leg where remoteSocketId is sending their screen to US.
  // Use this when a REMOTE peer stops sharing — any share we're sending
  // TO that peer must be left untouched.
  const closeIncomingScreenPeer = useCallback((remoteSocketId) => {
    const pc = incomingScreenPCs.current[remoteSocketId];
    if (pc) {
      pc.close();
      delete incomingScreenPCs.current[remoteSocketId];
      delete incomingScreenIceQueues.current[remoteSocketId];
      delete remoteScreenStreams.current[remoteSocketId];
    }
  }, []);

  // Full teardown of both legs — use only when the peer leaves the room
  // entirely (their socket disconnected), not for a single share stopping.
  const closeScreenPeer = useCallback((remoteSocketId) => {
    closeOutgoingScreenPeer(remoteSocketId);
    closeIncomingScreenPeer(remoteSocketId);
  }, [closeOutgoingScreenPeer, closeIncomingScreenPeer]);

  const closeAllScreenPeers = useCallback(() => {
    Object.keys(outgoingScreenPCs.current).forEach(closeOutgoingScreenPeer);
    Object.keys(incomingScreenPCs.current).forEach(closeIncomingScreenPeer);
  }, [closeOutgoingScreenPeer, closeIncomingScreenPeer]);

  return {
    peerConnections: peerConnections.current,
    makeOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closePeer,
    closeAll,
    replaceTrack,

    // Screen-share pools (direction-aware — see notes above)
    outgoingScreenPCs: outgoingScreenPCs.current,
    incomingScreenPCs: incomingScreenPCs.current,
    makeScreenOffer,
    handleScreenOffer,
    handleScreenAnswer,
    handleScreenIceCandidate,
    closeOutgoingScreenPeer,
    closeIncomingScreenPeer,
    closeScreenPeer,          // both legs — use only on full peer departure
    closeAllScreenPeers,
  };
}
