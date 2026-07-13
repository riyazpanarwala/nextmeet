// client/src/components/KeyboardShortcutsModal.jsx
import { PanelCloseButton } from './PanelCloseButton';

const SHORTCUTS = [
    { keys: 'M', label: 'Toggle mute' },
    { keys: 'V', label: 'Toggle camera' },
    { keys: 'S', label: 'Toggle screen share' },
    { keys: 'H', label: 'Raise / lower hand' },
    { keys: 'C', label: 'Toggle chat' },
    { keys: 'P', label: 'Toggle participants' },
    { keys: 'R', label: 'Toggle recording panel' },
    { keys: 'W', label: 'Toggle whiteboard' },
    { keys: '?', label: 'Show this shortcuts list' },
    { keys: 'Esc', label: 'Close open panels' },
];

export function KeyboardShortcutsModal({ onClose }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="shortcuts-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label="Keyboard shortcuts"
            >
                <div className="panel-header">
                    <h2>Keyboard Shortcuts</h2>
                    <PanelCloseButton onClose={onClose} label="Close shortcuts" />
                </div>
                <ul className="shortcuts-list">
                    {SHORTCUTS.map((s) => (
                        <li key={s.keys}>
                            <kbd>{s.keys}</kbd>
                            <span>{s.label}</span>
                        </li>
                    ))}
                </ul>
                <p className="shortcuts-hint">Shortcuts are disabled while typing in a text field.</p>
            </div>
        </div>
    );
}