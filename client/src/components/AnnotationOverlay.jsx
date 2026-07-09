import { useCallback, useEffect, useRef, useState } from 'react';

const STROKE_WIDTH = 3;
const ARROW_HEAD_LEN = 12;

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
  if (tool === 'pen') {
    const points = shape.points.map((p) => `${p.x * w},${p.y * h}`).join(' ');
    return (
      <polyline key={id} points={points} fill="none" stroke={color}
        strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
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
  return null;
}

export function AnnotationOverlay({
  videoRef,     // ref to the <video> element this overlay sits on top of
  shapes,       // finalized shapes for this screen (from useAnnotations)
  isOwner,      // only the sharer can draw
  tool,         // 'pen' | 'arrow' | 'rect' | 'circle' | null (null = pass-through)
  color,
  onAddShape,   // (shapeWithoutId) => void — called once per finished stroke/shape
}) {
  const containerRef = useRef(null);
  const [rect, setRect] = useState(null);
  const drawingRef = useRef(null);
  const [liveShape, setLiveShape] = useState(null); // in-progress preview, not yet broadcast

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

  const handlePointerDown = useCallback((e) => {
    if (!canDraw) return;
    e.target.setPointerCapture?.(e.pointerId);
    const pt = pointFromEvent(e);
    let shape;
    if (tool === 'pen') {
      shape = { tool: 'pen', color, points: [pt] };
    } else {
      shape = { tool, color, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    }
    drawingRef.current = shape;
    setLiveShape(shape);
  }, [canDraw, tool, color, pointFromEvent]);

  const handlePointerMove = useCallback((e) => {
    if (!drawingRef.current) return;
    const pt = pointFromEvent(e);
    if (drawingRef.current.tool === 'pen') {
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
      style={{ cursor: canDraw ? 'crosshair' : 'default', pointerEvents: canDraw ? 'auto' : 'none' }}
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
    </div>
  );
}
