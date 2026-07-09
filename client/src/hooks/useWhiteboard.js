import { useCallback, useEffect, useRef, useState } from 'react';

export function useWhiteboard({ socket, roomId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [shapes, setShapes] = useState([]);
  const idCounterRef = useRef(0);

  const nextShapeId = useCallback(() => {
    idCounterRef.current += 1;
    return `wb-${Date.now()}-${idCounterRef.current}`;
  }, []);

  const setInitialWhiteboard = useCallback((whiteboard) => {
    setIsOpen(Boolean(whiteboard?.open));
    setShapes(Array.isArray(whiteboard?.shapes) ? whiteboard.shapes : []);
  }, []);

  const setOpen = useCallback((open) => {
    setIsOpen(Boolean(open));
    socket?.emit('whiteboard-open-set', { roomId, open: Boolean(open) });
  }, [socket, roomId]);

  const addShape = useCallback((shapeWithoutId) => {
    const shape = { ...shapeWithoutId, id: nextShapeId() };
    setShapes((prev) => [...prev, shape]);
    socket?.emit('whiteboard-draw', { roomId, shape });
  }, [nextShapeId, roomId, socket]);

  const undoLastShape = useCallback(() => {
    setShapes((prev) => {
      if (!prev.length) return prev;
      const removed = prev[prev.length - 1];
      socket?.emit('whiteboard-undo', { roomId, shapeId: removed.id });
      return prev.slice(0, -1);
    });
  }, [roomId, socket]);

  const clearShapes = useCallback(() => {
    setShapes([]);
    socket?.emit('whiteboard-clear', { roomId });
  }, [roomId, socket]);

  useEffect(() => {
    if (!socket) return undefined;

    const onOpenUpdated = ({ open }) => setIsOpen(Boolean(open));
    const onDraw = ({ shape }) => setShapes((prev) => [...prev, shape]);
    const onUndo = ({ shapeId }) => {
      setShapes((prev) => prev.filter((shape) => shape.id !== shapeId));
    };
    const onClear = () => setShapes([]);

    socket.on('whiteboard-open-updated', onOpenUpdated);
    socket.on('whiteboard-draw', onDraw);
    socket.on('whiteboard-undo', onUndo);
    socket.on('whiteboard-clear', onClear);

    return () => {
      socket.off('whiteboard-open-updated', onOpenUpdated);
      socket.off('whiteboard-draw', onDraw);
      socket.off('whiteboard-undo', onUndo);
      socket.off('whiteboard-clear', onClear);
    };
  }, [socket]);

  return {
    isOpen,
    shapes,
    setInitialWhiteboard,
    setOpen,
    addShape,
    undoLastShape,
    clearShapes,
  };
}
