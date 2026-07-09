import { useCallback, useEffect, useRef, useState } from 'react';
import { AnnotationToolbar } from './AnnotationToolbar';
import { PanelCloseButton } from './PanelCloseButton';
import { downloadAnnotationPdf, downloadAnnotationPng } from '../utils/annotationExport';

const STROKE_WIDTH = 3;
const ARROW_HEAD_LEN = 12;

function renderShape(shape, w, h) {
  const { tool, color, id } = shape;
  if (tool === 'pen' || tool === 'highlighter') {
    const points = (shape.points || []).map((p) => `${p.x * w},${p.y * h}`).join(' ');
    const isHighlighter = tool === 'highlighter';
    return (
      <polyline
        key={id}
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={isHighlighter ? STROKE_WIDTH * 4 : STROKE_WIDTH}
        strokeOpacity={isHighlighter ? 0.38 : 1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (tool === 'line') {
    return <line key={id} x1={shape.x1 * w} y1={shape.y1 * h} x2={shape.x2 * w} y2={shape.y2 * h} stroke={color} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />;
  }
  if (tool === 'rect') {
    const x = Math.min(shape.x1, shape.x2) * w;
    const y = Math.min(shape.y1, shape.y2) * h;
    return <rect key={id} x={x} y={y} width={Math.abs(shape.x2 - shape.x1) * w} height={Math.abs(shape.y2 - shape.y1) * h} rx={4} fill="none" stroke={color} strokeWidth={STROKE_WIDTH} />;
  }
  if (tool === 'circle') {
    const x1 = shape.x1 * w;
    const y1 = shape.y1 * h;
    const x2 = shape.x2 * w;
    const y2 = shape.y2 * h;
    return <ellipse key={id} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} fill="none" stroke={color} strokeWidth={STROKE_WIDTH} />;
  }
  if (tool === 'arrow') {
    const x1 = shape.x1 * w;
    const y1 = shape.y1 * h;
    const x2 = shape.x2 * w;
    const y2 = shape.y2 * h;
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

export function WhiteboardPanel({
  roomId,
  shapes,
  tool,
  color,
  onSelectTool,
  onSelectColor,
  onAddShape,
  onUndo,
  onClear,
  onClose,
}) {
  const boardRef = useRef(null);
  const drawingRef = useRef(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [liveShape, setLiveShape] = useState(null);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;

    const update = () => {
      setSize({ width: board.clientWidth || 1, height: board.clientHeight || 1 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(board);
    return () => ro.disconnect();
  }, []);

  const pointFromEvent = useCallback((event) => {
    const box = boardRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (!tool) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointFromEvent(event);
    const shape = tool === 'pen' || tool === 'highlighter'
      ? { tool, color, points: [point] }
      : { tool, color, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    drawingRef.current = shape;
    setLiveShape(shape);
  }, [color, pointFromEvent, tool]);

  const handlePointerMove = useCallback((event) => {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    if (drawingRef.current.tool === 'pen' || drawingRef.current.tool === 'highlighter') {
      drawingRef.current = { ...drawingRef.current, points: [...drawingRef.current.points, point] };
    } else {
      drawingRef.current = { ...drawingRef.current, x2: point.x, y2: point.y };
    }
    setLiveShape(drawingRef.current);
  }, [pointFromEvent]);

  const finishShape = useCallback(() => {
    if (!drawingRef.current) return;
    onAddShape(drawingRef.current);
    drawingRef.current = null;
    setLiveShape(null);
  }, [onAddShape]);

  const allShapes = liveShape ? [...shapes, liveShape] : shapes;

  const handleExport = async (format) => {
    if (!shapes.length) return;
    const fileBase = `nexmeet-${roomId}-whiteboard`;
    if (format === 'pdf') {
      downloadAnnotationPdf(shapes, 'NexMeet whiteboard', `${fileBase}.pdf`);
    } else {
      await downloadAnnotationPng(shapes, 'NexMeet whiteboard', `${fileBase}.png`);
    }
  };

  return (
    <div className="whiteboard-panel">
      <div className="whiteboard-header">
        <div>
          <h2>Whiteboard</h2>
          <span>{shapes.length} mark{shapes.length === 1 ? '' : 's'}</span>
        </div>
        <PanelCloseButton onClose={onClose} label="Close whiteboard" />
      </div>

      <div className="whiteboard-toolbar-wrap">
        <AnnotationToolbar
          tool={tool}
          onSelectTool={onSelectTool}
          color={color}
          onSelectColor={onSelectColor}
          onUndo={onUndo}
          onClear={onClear}
          hasShapes={shapes.length > 0}
          onExportPng={() => handleExport('png')}
          onExportPdf={() => handleExport('pdf')}
        />
      </div>

      <div
        ref={boardRef}
        className={`whiteboard-canvas ${tool ? 'drawing' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishShape}
        onPointerLeave={finishShape}
      >
        <svg width={size.width} height={size.height}>
          {allShapes.map((shape) => renderShape(shape, size.width, size.height))}
        </svg>
      </div>
    </div>
  );
}
