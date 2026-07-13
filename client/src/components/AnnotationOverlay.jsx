import { useCallback, useEffect, useRef, useState } from 'react';

const STROKE_WIDTH = 3;
const ARROW_HEAD_LEN = 12;
const TEXT_FONT_SIZE = 18;
const TEXT_MAX_LENGTH = 300;

// Computes the letterboxed content rect (in pixels, relative to `container`)
// that the video actually occupies given object-fit: contain. Every viewer
// runs this independently against their own tile size, but since shapes are
// stored as 0-1 FRACTIONS of this rect (not raw pixels), they line up
// correctly for everyone regardless of window size or sidebar-vs-main layout.
function getContentRect(container, video) {
  if (!container || !video || !video.videoWidth || !video.videoHeight) return null;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (!cw || !ch) return null;
  const videoAspect = video.videoWidth / video.videoHeight;
  const containerAspect = cw / ch;
  let width, height;
  if (containerAspect > videoAspect) {
    height = ch;
    width = ch * videoAspect;
  } else {
    width = cw;
    height = cw / videoAspect;
  }
  return { left: (cw - width) / 2, top: (ch - height) / 2, width, height };
}

function renderShape(shape, w, h) {
  const { tool, color, id } = shape;
  if (tool === 'pen' || tool === 'highlighter') {
    const points = shape.points.map((p) => `${p.x * w},${p.y * h}`).join(' ');
    const isHighlighter = tool === 'highlighter';
    return (
      <polyline key={id} points={points} fill="none" stroke={color}
        strokeWidth={isHighlighter ? STROKE_WIDTH * 4 : STROKE_WIDTH}
        strokeOpacity={isHighlighter ? 0.38 : 1}
        strokeLinecap="round" strokeLinejoin="round" />
    );
  }
  if (tool === 'line') {
    const x1 = shape.x1 * w, y1 = shape.y1 * h, x2 = shape.x2 * w, y2 = shape.y2 * h;
    return (
      <line key={id} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    );
  }
  if (tool === 'rect') {
    const x = Math.min(shape.x1, shape.x2) * w;
    const y = Math.min(shape.y1, shape.y2) * h;
    const rw = Math.abs(shape.x2 - shape.x1) * w;
    const rh = Math.abs(shape.y2 - shape.y1) * h;
    return (
      <rect key={id} x={x} y={y} width={rw} height={rh} rx={3}
        fill="none" stroke={color} strokeWidth={STROKE_WIDTH} />
    );
  }
  if (tool === 'circle') {
    const x1 = shape.x1 * w, y1 = shape.y1 * h, x2 = shape.x2 * w, y2 = shape.y2 * h;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    return (
      <ellipse key={id} cx={cx} cy={cy} rx={rx} ry={ry}
        fill="none" stroke={color} strokeWidth={STROKE_WIDTH} />
    );
  }
  if (tool === 'arrow') {
    const x1 = shape.x1 * w, y1 = shape.y1 * h, x2 = shape.x2 * w, y2 = shape.y2 * h;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const hx1 = x2 - ARROW_HEAD_LEN * Math.cos(angle - Math.PI / 6);
    const hy1 = y2 - ARROW_HEAD_LEN * Math.sin(angle - Math.PI / 6);
    const hx2 = x2 - ARROW_HEAD_LEN * Math.cos(angle + Math.PI / 6);
    const hy2 = y2 - ARROW_HEAD_LEN * Math.sin(angle + Math.PI / 6);
    return (
      <g key={id} stroke={color} strokeWidth={STROKE_WIDTH} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <polyline points={`${hx1},${hy1} ${x2},${y2} ${hx2},${hy2}`} />
      </g>
    );
  }
  if (tool === 'text') {
    if (!shape.text) return null;
    return (
      <text
        key={id}
        x={shape.x * w}
        y={shape.y * h}
        fill={color}
        fontSize={TEXT_FONT_SIZE}
        fontFamily="'DM Sans', sans-serif"
        dominantBaseline="hanging"
        style={{ whiteSpace: 'pre' }}
      >
        {shape.text}
      </text>
    );
  }
  return null;
}

export function AnnotationOverlay({
  videoRef,     // ref to the <video> element this overlay sits on top of
  shapes,       // finalized shapes for this screen (from useAnnotations)
  isOwner,      // only the sharer can draw
  tool,         // selected drawing tool; null = pass-through
  color,
  onAddShape,   // (shapeWithoutId) => void — called once per finished stroke/shape
}) {
  const containerRef = useRef(null);
  const [rect, setRect] = useState(null);
  const drawingRef = useRef(null);
  const [liveShape, setLiveShape] = useState(null); // in-progress preview, not yet broadcast
  // Text tool uses click-to-place + type instead of the click-drag-release
  // model every other tool uses, so it gets its own small piece of state:
  // the normalized position of the in-progress text box and its current
  // (uncommitted) value.
  const [textEditor, setTextEditor] = useState(null); // { x, y, value }
  const textInputRef = useRef(null);

  const recalc = useCallback(() => {
    setRect(getContentRect(containerRef.current, videoRef.current));
  }, [videoRef]);

  useEffect(() => {
    recalc();
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return undefined;

    video.addEventListener('loadedmetadata', recalc);
    video.addEventListener('resize', recalc);
    const ro = new ResizeObserver(recalc);
    ro.observe(container);

    return () => {
      video.removeEventListener('loadedmetadata', recalc);
      video.removeEventListener('resize', recalc);
      ro.disconnect();
    };
  }, [recalc, videoRef]);

  const pointFromEvent = useCallback((e) => {
    const box = containerRef.current.getBoundingClientRect();
    const localX = e.clientX - box.left - rect.left;
    const localY = e.clientY - box.top - rect.top;
    return {
      x: Math.min(1, Math.max(0, localX / rect.width)),
      y: Math.min(1, Math.max(0, localY / rect.height)),
    };
  }, [rect]);

  const canDraw = isOwner && !!tool && !!rect;

  // Commits whatever is currently in the text editor (if non-empty) as a
  // finished shape, then closes the editor. Used on Enter, blur, and when
  // starting a new text box while one is still open.
  const commitTextEditor = useCallback(() => {
    setTextEditor((current) => {
      if (current && current.value.trim()) {
        onAddShape({
          tool: 'text',
          color,
          x: current.x,
          y: current.y,
          text: current.value.trim().slice(0, TEXT_MAX_LENGTH),
        });
      }
      return null;
    });
  }, [onAddShape, color]);

  const cancelTextEditor = useCallback(() => setTextEditor(null), []);

  // Focus the input once a text-editing SESSION starts (not on every
  // keystroke — see the [Boolean(textEditor)] dependency below). We do
  // this imperatively via a ref rather than relying on the input's
  // `autoFocus` attribute, because on desktop, mousedown carries a native
  // default action that shifts focus based on the ORIGINAL click target
  // (this overlay div, which isn't focusable) — that default action runs
  // right after our pointerdown handler returns, which raced with and
  // undid React's autoFocus, immediately blurring the input before a
  // single character could be typed. Touch's touchstart doesn't carry
  // that same default action, which is why this only broke on desktop.
  // preventDefault() in handlePointerDown (below) cancels that native
  // focus-shift outright; this effect is the belt-and-suspenders way of
  // making sure focus lands correctly regardless of browser timing.
  useEffect(() => {
    if (textEditor) {
      textInputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(textEditor)]);

  // If the tool changes away from 'text' (or access is revoked) while a
  // text box is still being typed, commit it rather than silently losing
  // whatever the user had written.
  useEffect(() => {
    if (tool !== 'text' && textEditor) {
      commitTextEditor();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const handlePointerDown = useCallback((e) => {
    if (!canDraw) return;

    if (tool === 'text') {
      // Cancels the browser's native mousedown default action (focus
      // shift / potential text-selection start) — see the comment on the
      // focus useEffect above for why this matters specifically on
      // desktop/mouse input.
      e.preventDefault();
      // Placing a second text box while one is still open commits the
      // first instead of discarding it.
      commitTextEditor();
      const pt = pointFromEvent(e);
      setTextEditor({ x: pt.x, y: pt.y, value: '' });
      return;
    }

    e.target.setPointerCapture?.(e.pointerId);
    const pt = pointFromEvent(e);
    let shape;
    if (tool === 'pen' || tool === 'highlighter') {
      shape = { tool, color, points: [pt] };
    } else {
      shape = { tool, color, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    }
    drawingRef.current = shape;
    setLiveShape(shape);
  }, [canDraw, tool, color, pointFromEvent, commitTextEditor]);

  const handlePointerMove = useCallback((e) => {
    if (!drawingRef.current) return;
    const pt = pointFromEvent(e);
    if (drawingRef.current.tool === 'pen' || drawingRef.current.tool === 'highlighter') {
      drawingRef.current = { ...drawingRef.current, points: [...drawingRef.current.points, pt] };
    } else {
      drawingRef.current = { ...drawingRef.current, x2: pt.x, y2: pt.y };
    }
    setLiveShape(drawingRef.current);
  }, [pointFromEvent]);

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    onAddShape(drawingRef.current);
    drawingRef.current = null;
    setLiveShape(null);
  }, [onAddShape]);

  if (!rect) return <div ref={containerRef} className="annotation-overlay-root" />;

  const allShapes = liveShape ? [...shapes, liveShape] : shapes;

  return (
    <div
      ref={containerRef}
      className="annotation-overlay-root"
      style={{ cursor: canDraw ? (tool === 'text' ? 'text' : 'crosshair') : 'default', pointerEvents: canDraw ? 'auto' : 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <svg
        width={rect.width}
        height={rect.height}
        style={{ position: 'absolute', left: rect.left, top: rect.top }}
      >
        {allShapes.map((s) => renderShape(s, rect.width, rect.height))}
      </svg>

      {textEditor && (
        <div
          className="annotation-text-editor"
          style={{
            left: rect.left + textEditor.x * rect.width,
            top: rect.top + textEditor.y * rect.height,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            ref={textInputRef}
            type="text"
            value={textEditor.value}
            maxLength={TEXT_MAX_LENGTH}
            placeholder="Type annotation…"
            style={{ color }}
            onChange={(e) => setTextEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTextEditor();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelTextEditor();
              }
            }}
            onBlur={commitTextEditor}
          />
        </div>
      )}
    </div>
  );
}