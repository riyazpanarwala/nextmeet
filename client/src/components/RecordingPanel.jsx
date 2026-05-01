import { useEffect, useState } from 'react';

function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function RecordingPanel({
  isRecording,
  duration,
  lastBlob,
  onStart,
  onStop,
  onDownload,
  onDismiss,
  participantCount,
}) {
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (lastBlob) {
      const url = URL.createObjectURL(lastBlob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setBlobUrl(null);
    }
  }, [lastBlob]);

  const fileSizeMB = lastBlob ? (lastBlob.size / 1024 / 1024).toFixed(1) : null;

  return (
    <div className="side-panel recording-panel">
      <div className="panel-header">
        <h2>Recording</h2>
        {isRecording && (
          <span className="rec-live-badge">
            <span className="rec-dot" />
            LIVE
          </span>
        )}
      </div>

      <div className="recording-body">
        {/* Status */}
        <div className={`rec-status-card ${isRecording ? 'active' : ''}`}>
          <div className="rec-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" fill={isRecording ? '#ef4444' : 'currentColor'} stroke="none" />
            </svg>
          </div>
          <div className="rec-status-text">
            {isRecording ? (
              <>
                <span className="rec-status-label">Recording in progress</span>
                <span className="rec-timer">{formatDuration(duration)}</span>
              </>
            ) : (
              <>
                <span className="rec-status-label">Ready to record</span>
                <span className="rec-status-sub">{participantCount} participant{participantCount !== 1 ? 's' : ''} in room</span>
              </>
            )}
          </div>
        </div>

        {/* Info box */}
        <div className="rec-info-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            Records all participants as a composite grid with mixed audio.
            Saved locally to your device — nothing is uploaded.
          </span>
        </div>

        {/* Controls */}
        {!isRecording ? (
          <button className="rec-start-btn" onClick={onStart}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <circle cx="12" cy="12" r="8" />
            </svg>
            Start Recording
          </button>
        ) : (
          <button className="rec-stop-btn" onClick={onStop}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            Stop Recording
          </button>
        )}

        {/* Download section — shown after recording stops */}
        {lastBlob && !isRecording && (
          <div className="rec-download-section">
            <div className="rec-download-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Recording complete</span>
              <span className="rec-filesize">{fileSizeMB} MB</span>
            </div>

            {/* Preview */}
            {blobUrl && (
              <video
                className="rec-preview"
                src={blobUrl}
                controls
                preload="metadata"
              />
            )}

            <div className="rec-download-actions">
              <button className="rec-download-btn" onClick={() => onDownload()}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>
              <button className="rec-dismiss-btn" onClick={onDismiss}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
