import { useState, useEffect } from 'react';

// Computes elapsed time from a SHARED anchor timestamp (the room's
// server-stamped creation time, ms epoch) rather than this client's own
// Date.now() at mount. Every participant receives the same roomCreatedAt
// value from the server in 'room-joined', so all clients' timers count
// from the identical moment instead of drifting apart by however many
// seconds/minutes separated when each person actually joined.
//
// Returns 0 until roomCreatedAt is known (e.g. briefly, before
// 'room-joined' has arrived).
export function useMeetingTimer(roomCreatedAt) {
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        if (!roomCreatedAt) {
            setElapsedSeconds(0);
            return undefined;
        }

        const update = () => {
            // Clamp to 0 in case of minor client/server clock skew that
            // would otherwise show a brief negative value right at join.
            setElapsedSeconds(Math.max(0, Math.floor((Date.now() - roomCreatedAt) / 1000)));
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [roomCreatedAt]);

    return elapsedSeconds;
}

export function formatElapsed(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}