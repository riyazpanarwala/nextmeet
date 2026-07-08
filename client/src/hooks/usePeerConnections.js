import { useRef, useCallback } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Add TURN for production (needed behind symmetric NAT):
  // { urls: 'turn:your-server:3478', username: 'user', credential: 'pass' },
];

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

  // socketId -> RTCPeerConnection (dedicated screen-share connection)
  const screenPeerConnections = useRef({});
  const screenIceCandidateQueues = useRef({});

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
        tracks.forEach((track) => pc.addTrack(track, stream));
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
      // ontrack fires once per track; we collect into a MediaStream
      const remoteStream = new MediaStream();
      pc.ontrack = ({ track, streams }) => {
        console.log('[PC] Got remote track:', track.kind, 'from', remoteSocketId);
        if (streams && streams[0]) {
          // Use the stream provided by the browser — preferred
          onRemoteStream(remoteSocketId, streams[0]);
        } else {
          // Fallback: manually build a MediaStream
          remoteStream.addTrack(track);
          onRemoteStream(remoteSocketId, remoteStream);
        }
      };

      peerConnections.current[remoteSocketId] = pc;
      return pc;
    },
    [socket, localStreamRef, onRemoteStream, onPeerLeft]
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
    }
  }, []);

  const closeAll = useCallback(() => {
    Object.keys(peerConnections.current).forEach(closePeer);
  }, [closePeer]);

  const replaceTrack = useCallback(async (oldTrack, newTrack) => {
    const promises = Object.values(peerConnections.current).map(async (pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === (oldTrack?.kind || newTrack?.kind));
      if (sender) await sender.replaceTrack(newTrack);
    });
    await Promise.all(promises);
  }, []);

  // ══════════════════════════════════════════════════════════════
  // SCREEN-SHARE PEER CONNECTIONS (dedicated, separate from camera PCs)
  //
  // Each screen share gets its own RTCPeerConnection per remote peer.
  // The SHARER creates a send-only PC per viewer (Approach B). Viewers
  // create a receive-only PC on offer. This keeps the camera PC fully
  // untouched — the sharer's own camera tile never disappears — and
  // avoids needing renegotiation/mid-tracking on the camera connection.
  // ══════════════════════════════════════════════════════════════

  const createScreenPeerConnection = useCallback(
    (remoteSocketId, isSender, screenStream) => {
      if (screenPeerConnections.current[remoteSocketId]) {
        return screenPeerConnections.current[remoteSocketId];
      }

      console.log('[ScreenPC] Creating screen peer connection for:', remoteSocketId, isSender ? '(sender)' : '(receiver)');
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      screenIceCandidateQueues.current[remoteSocketId] = [];
      pc._negotiationReady = false;
      pc._makingOffer = false;

      // Add every track from the screen stream — video AND audio (tab/
      // system audio, when the browser/user grants it) — not just video.
      // Previously only the video track was ever passed in here, so
      // remote viewers never received screen-share audio.
      if (isSender && screenStream) {
        screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));
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
        console.log('[ScreenPC] Connection state:', state, 'for', remoteSocketId);
        if (state === 'failed') {
          pc.restartIce();
        }
        if (state === 'disconnected' || state === 'closed') {
          onScreenPeerLeft?.(remoteSocketId);
        }
      };

      const remoteStream = new MediaStream();
      pc.ontrack = ({ track, streams }) => {
        console.log('[ScreenPC] Got remote screen track from', remoteSocketId, track.kind);
        if (streams && streams[0]) {
          onRemoteScreenStream(remoteSocketId, streams[0]);
        } else {
          remoteStream.addTrack(track);
          onRemoteScreenStream(remoteSocketId, remoteStream);
        }
      };

      screenPeerConnections.current[remoteSocketId] = pc;
      return pc;
    },
    [socket, onRemoteScreenStream, onScreenPeerLeft]
  );

  const drainScreenIceQueue = useCallback(async (remoteSocketId) => {
    const pc = screenPeerConnections.current[remoteSocketId];
    const queue = screenIceCandidateQueues.current[remoteSocketId] || [];
    if (!pc || queue.length === 0) return;

    console.log('[ScreenPC] Draining', queue.length, 'queued ICE candidates for', remoteSocketId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[ScreenPC] Failed to add queued ICE candidate:', err);
      }
    }
    screenIceCandidateQueues.current[remoteSocketId] = [];
  }, []);

  // Called by the SHARER for each remote participant (existing + late joiners).
  // `screenStream` is the FULL MediaStream from getDisplayMedia (video + audio).
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

  // Called by VIEWERS when a screen-share offer arrives
  const handleScreenOffer = useCallback(
    async (remoteSocketId, offer) => {
      const pc = createScreenPeerConnection(remoteSocketId, false);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await drainScreenIceQueue(remoteSocketId);

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

  const handleScreenAnswer = useCallback(async (remoteSocketId, answer) => {
    const pc = screenPeerConnections.current[remoteSocketId];
    if (!pc) {
      console.warn('[ScreenPC] handleScreenAnswer: no PC for', remoteSocketId);
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      pc._negotiationReady = true;
      pc._makingOffer = false;
      await drainScreenIceQueue(remoteSocketId);
    } catch (err) {
      console.error('[ScreenPC] handleScreenAnswer error:', err);
    }
  }, [drainScreenIceQueue]);

  const handleScreenIceCandidate = useCallback(async (remoteSocketId, candidate) => {
    const pc = screenPeerConnections.current[remoteSocketId];
    const rtcCandidate = new RTCIceCandidate(candidate);

    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      screenIceCandidateQueues.current[remoteSocketId] =
        screenIceCandidateQueues.current[remoteSocketId] || [];
      screenIceCandidateQueues.current[remoteSocketId].push(rtcCandidate);
      return;
    }

    try {
      await pc.addIceCandidate(rtcCandidate);
    } catch (err) {
      console.warn('[ScreenPC] addIceCandidate error:', err);
    }
  }, []);

  const closeScreenPeer = useCallback((remoteSocketId) => {
    const pc = screenPeerConnections.current[remoteSocketId];
    if (pc) {
      pc.close();
      delete screenPeerConnections.current[remoteSocketId];
      delete screenIceCandidateQueues.current[remoteSocketId];
    }
  }, []);

  const closeAllScreenPeers = useCallback(() => {
    Object.keys(screenPeerConnections.current).forEach(closeScreenPeer);
  }, [closeScreenPeer]);

  return {
    peerConnections: peerConnections.current,
    makeOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closePeer,
    closeAll,
    replaceTrack,

    // Screen-share pool
    screenPeerConnections: screenPeerConnections.current,
    makeScreenOffer,
    handleScreenOffer,
    handleScreenAnswer,
    handleScreenIceCandidate,
    closeScreenPeer,
    closeAllScreenPeers,
  };
}