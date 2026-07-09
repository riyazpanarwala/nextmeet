import { useEffect, useState } from 'react';

function qualityFromStats(stats) {
  let packetsLost = 0;
  let packetsReceived = 0;
  let jitter = 0;
  let roundTripTime = 0;

  stats.forEach((report) => {
    if (report.type === 'inbound-rtp' && !report.isRemote) {
      packetsLost += report.packetsLost || 0;
      packetsReceived += report.packetsReceived || 0;
      jitter = Math.max(jitter, report.jitter || 0);
    }
    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
      roundTripTime = report.currentRoundTripTime || roundTripTime;
    }
  });

  const totalPackets = packetsLost + packetsReceived;
  const lossRatio = totalPackets ? packetsLost / totalPackets : 0;

  if (roundTripTime > 0.45 || lossRatio > 0.08 || jitter > 0.08) return 'poor';
  if (roundTripTime > 0.2 || lossRatio > 0.03 || jitter > 0.04) return 'fair';
  return 'good';
}

export function useConnectionQuality(peerConnections, peerIds) {
  const [qualityByPeer, setQualityByPeer] = useState({});

  useEffect(() => {
    if (!peerConnections || peerIds.length === 0) {
      setQualityByPeer({});
      return undefined;
    }

    let cancelled = false;

    const sample = async () => {
      const entries = await Promise.all(peerIds.map(async (peerId) => {
        const pc = peerConnections[peerId];
        if (!pc || pc.connectionState === 'closed') return [peerId, 'unknown'];
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') return [peerId, 'poor'];
        if (pc.connectionState === 'connecting') return [peerId, 'fair'];

        try {
          const stats = await pc.getStats();
          return [peerId, qualityFromStats(stats)];
        } catch {
          return [peerId, 'unknown'];
        }
      }));

      if (!cancelled) setQualityByPeer(Object.fromEntries(entries));
    };

    sample();
    const interval = setInterval(sample, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [peerConnections, peerIds.join('|')]);

  return qualityByPeer;
}
