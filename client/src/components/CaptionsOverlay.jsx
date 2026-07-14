export function CaptionsOverlay({ captionsBySpeaker }) {
    const lines = Object.entries(captionsBySpeaker)
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
        .slice(-3); // most recent 3 active speakers, oldest on top

    if (!lines.length) return null;

    return (
        <div className="captions-overlay" aria-live="polite">
            {lines.map(([socketId, line]) => (
                <div key={socketId} className={`caption-line ${line.isFinal ? '' : 'interim'}`}>
                    <span className="caption-speaker">{line.name}</span>
                    <span className="caption-text">{line.text}</span>
                </div>
            ))}
        </div>
    );
}