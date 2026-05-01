import { useRef, useCallback } from 'react';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Add TURN for production (needed behind symmetric NAT):
  // { urls: 'turn:your-server:3478', username: 'user', credential: 'pass' },
];

export function usePeerConnections({ socket, localStreamRef, onRemoteStream, onPeerLeft }) {
  // socketId -> RTCPeerConnection
  const peerConnections = useRef({});
  // socketId -> RTCIceCandidate[] (queued before remoteDescription is set)
  const iceCandidateQueues = useRef({});

  const createPeerConnection = useCallback(
    (remoteSocketId) => {
      if (peerConnections.current[remoteSocketId]) {
        return peerConnections.current[remoteSocketId];
      }

      console.log('[PC] Creating peer connection for:', remoteSocketId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      iceCandidateQueues.current[remoteSocketId] = [];

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
          socket.emit('ice-candidate', { to: remoteSocketId, candidate });
        }
      };

      pc.onicegatheringstatechange = () => {
        console.log('[PC] ICE gathering state:', pc.iceGatheringState, 'for', remoteSocketId);
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
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        console.log('[PC] Sending offer to:', remoteSocketId);
        socket.emit('offer', { to: remoteSocketId, offer: pc.localDescription });
      } catch (err) {
        console.error('[PC] makeOffer error:', err);
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
        console.log('[PC] Sending answer to:', remoteSocketId);
        socket.emit('answer', { to: remoteSocketId, answer: pc.localDescription });
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

  return {
    peerConnections: peerConnections.current,
    makeOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    closePeer,
    closeAll,
    replaceTrack,
  };
}
