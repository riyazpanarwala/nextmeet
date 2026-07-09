import { useState, useEffect, useRef } from 'react';
import { PanelCloseButton } from './PanelCloseButton';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const REACTIONS = ['+1', 'Heart', 'Ha'];

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatPanel({ messages, onSend, onReact, localSocketId, onClose }) {
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [fileError, setFileError] = useState('');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !selectedFile) return;

    let filePayload = null;
    if (selectedFile) {
      filePayload = {
        name: selectedFile.name,
        type: selectedFile.type || 'application/octet-stream',
        size: selectedFile.size,
        dataUrl: await readFileAsDataUrl(selectedFile),
      };
    }

    onSend({
      message: text,
      file: filePayload,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            name: replyTo.name,
            message: replyTo.message,
            fileName: replyTo.file?.name,
          }
        : null,
    });
    setInput('');
    setSelectedFile(null);
    setReplyTo(null);
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setFileError('');
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setSelectedFile(null);
      setFileError(`File must be ${formatBytes(MAX_FILE_BYTES)} or smaller.`);
      e.target.value = '';
      return;
    }
    setSelectedFile(file);
  };

  const getReplyTarget = (reply) => {
    if (!reply) return '';
    return reply.message || reply.fileName || 'Attachment';
  };

  return (
    <div className="side-panel chat-panel">
      <div className="panel-header">
        <h2>Chat</h2>
        <PanelCloseButton onClose={onClose} label="Close chat" />
      </div>
      <div className="messages-list">
        {messages.length === 0 && (
          <p className="empty-state">No messages yet. Say hi!</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.from === localSocketId;
          const reactions = Object.entries(msg.reactions || {});
          return (
            <div key={msg.id} className={`message ${isMe ? 'message-me' : 'message-them'}`}>
              {!isMe && <span className="msg-author">{msg.name}</span>}
              <div className="msg-bubble">
                {msg.replyTo && (
                  <button
                    type="button"
                    className="msg-reply-preview"
                    onClick={() => setReplyTo(msg)}
                    title="Reply to this message"
                  >
                    <span>{msg.replyTo.name}</span>
                    {getReplyTarget(msg.replyTo)}
                  </button>
                )}
                {msg.message && <p>{msg.message}</p>}
                {msg.file && (
                  <a className="msg-file" href={msg.file.dataUrl} download={msg.file.name}>
                    <span className="msg-file-icon">FILE</span>
                    <span>
                      <strong>{msg.file.name}</strong>
                      <small>{formatBytes(msg.file.size)}</small>
                    </span>
                  </a>
                )}
              </div>
              <div className="msg-actions">
                <button type="button" onClick={() => setReplyTo(msg)}>Reply</button>
                {REACTIONS.map((reaction) => (
                  <button key={reaction} type="button" onClick={() => onReact(msg.id, reaction)}>
                    {reaction}
                  </button>
                ))}
              </div>
              {reactions.length > 0 && (
                <div className="msg-reactions">
                  {reactions.map(([reaction, users]) => (
                    <span key={reaction}>{reaction} {Object.keys(users || {}).length}</span>
                  ))}
                </div>
              )}
              <span className="msg-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {(replyTo || selectedFile || fileError) && (
        <div className="chat-compose-meta">
          {replyTo && (
            <div className="compose-chip">
              <span>Replying to {replyTo.name}</span>
              <button type="button" onClick={() => setReplyTo(null)}>Clear</button>
            </div>
          )}
          {selectedFile && (
            <div className="compose-chip">
              <span>{selectedFile.name} - {formatBytes(selectedFile.size)}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Remove
              </button>
            </div>
          )}
          {fileError && <div className="compose-error">{fileError}</div>}
        </div>
      )}
      <div className="chat-input-row">
        <input
          ref={fileInputRef}
          type="file"
          className="chat-file-input"
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="chat-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
        >
          Attach
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message..."
          rows={2}
        />
        <button onClick={handleSend} disabled={!input.trim() && !selectedFile}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
