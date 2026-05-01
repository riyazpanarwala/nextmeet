import { useState, useEffect, useRef } from 'react';

export function ChatPanel({ messages, onSend, localSocketId }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="side-panel chat-panel">
      <div className="panel-header">
        <h2>Chat</h2>
      </div>
      <div className="messages-list">
        {messages.length === 0 && (
          <p className="empty-state">No messages yet. Say hi! 👋</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.from === localSocketId;
          return (
            <div key={msg.id} className={`message ${isMe ? 'message-me' : 'message-them'}`}>
              {!isMe && <span className="msg-author">{msg.name}</span>}
              <div className="msg-bubble">{msg.message}</div>
              <span className="msg-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message…"
          rows={2}
        />
        <button onClick={handleSend} disabled={!input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
