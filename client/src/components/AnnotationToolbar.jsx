const TOOLS = [
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Highlight' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'rect', label: 'Box' },
  { id: 'circle', label: 'Circle' },
  { id: 'text', label: 'Text' },
];

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#f1f5f9'];

const CursorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51z" />
  </svg>
);

/**
 * Shown only when the LOCAL user is the one sharing their screen — matches
 * the "only the sharer can draw" permission model. Toggling `tool` to null
 * releases pointer capture on the overlay so the presenter can still click
 * through to things like the "Set as Main" pin button underneath.
 */
export function AnnotationToolbar({
  tool,
  onSelectTool,
  color,
  onSelectColor,
  onUndo,
  onClear,
  targets = [],
  activeTargetId,
  onSelectTarget,
  hasShapes = false,
  onExportPng,
  onExportPdf,
}) {
  return (
    <div className="annotation-toolbar">
      {targets.length > 0 && (
        <>
          <select
            className="annot-target-select"
            value={activeTargetId || targets[0]?.id || ''}
            onChange={(e) => onSelectTarget?.(e.target.value)}
            title="Choose screen to annotate"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>

          <div className="annot-divider" />
        </>
      )}

      <button
        type="button"
        className={`annot-btn ${!tool ? 'active' : ''}`}
        onClick={() => onSelectTool(null)}
        title="Stop drawing (interact normally)"
      >
        <CursorIcon />
      </button>

      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`annot-btn ${tool === t.id ? 'active' : ''}`}
          onClick={() => onSelectTool(t.id)}
          title={t.label}
        >
          {t.label}
        </button>
      ))}

      <div className="annot-divider" />

      <div className="annot-colors">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`annot-swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => onSelectColor(c)}
            title={c}
          />
        ))}
      </div>

      <div className="annot-divider" />

      <button type="button" className="annot-btn" onClick={onUndo} title="Undo last shape">
        Undo
      </button>
      <button type="button" className="annot-btn danger" onClick={onClear} title="Clear all annotations">
        Clear
      </button>

      <div className="annot-divider" />

      <button
        type="button"
        className="annot-btn"
        onClick={onExportPng}
        disabled={!hasShapes}
        title="Export annotations as PNG"
      >
        PNG
      </button>
      <button
        type="button"
        className="annot-btn"
        onClick={onExportPdf}
        disabled={!hasShapes}
        title="Export annotations as PDF"
      >
        PDF
      </button>
    </div>
  );
}
