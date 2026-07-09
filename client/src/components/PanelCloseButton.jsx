import { CloseIcon } from './icons/CloseIcon';

/**
 * Shared close (✕) button used by every side panel / settings panel.
 * `label` feeds both `title` and `aria-label` for consistency.
 */
export function PanelCloseButton({ onClose, label = 'Close' }) {
    if (!onClose) return null;

    return (
        <button
            type="button"
            className="panel-close-btn"
            onClick={onClose}
            title={label}
            aria-label={label}
        >
            <CloseIcon />
        </button>
    );
}