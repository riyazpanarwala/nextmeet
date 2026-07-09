import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useAnnotations — sharer-only screen-share drawing, synced via Socket.IO.
 *
 * Design notes:
 * - Shapes are NEVER baked into the actual screen-share video. The video
 *   stream stays untouched; every client renders the same shape list on a
 *   transparent overlay on top of the relevant <video>. This avoids adding
 *   latency/encoding cost to the screen-share track itself.
 * - Shapes are keyed by `screenOwnerId` (the socketId of whoever is
 *   sharing) so simultaneous shares (up to MAX_SCREEN_SHARES) each get
 *   their own independent shape list — annotating one share never touches
 *   the other.
 * - Only the sharer is allowed to draw (enforced client-side by only
 *   mounting the toolbar for the local sharer, and server-side by
 *   rejecting any draw/undo/clear whose screenOwnerId doesn't match the
 *   emitting socket).
 * - Shapes are ephemeral, exactly like chat is NOT ephemeral but hand-state
 *   IS: there's no server-side history, so a participant who joins mid-share
 *   won't see annotations drawn before they joined. That mirrors how
 *   live-annotation works in most conferencing tools and keeps the server
 *   stateless for this feature.
 */
export function useAnnotations({ socket, roomId }) {
  // screenOwnerId -> Shape[]
  const [shapesByScreen, setShapesByScreen] = useState({});
  const idCounterRef = useRef(0);

  const nextShapeId = useCallback(() => {
    idCounterRef.current += 1;
    return `shp-${Date.now()}-${idCounterRef.current}`;
  }, []);

  // Called by the sharer once a shape is finalized (pointer released).
  const addShape = useCallback((screenOwnerId, shapeWithoutId) => {
    const shape = { ...shapeWithoutId, id: nextShapeId() };
    setShapesByScreen((prev) => ({
      ...prev,
      [screenOwnerId]: [...(prev[screenOwnerId] || []), shape],
    }));
    socket?.emit('annotation-draw', { roomId, screenOwnerId, shape });
  }, [socket, roomId, nextShapeId]);

  // Removes the most recently drawn shape for this screen (sharer only).
  const undoLastShape = useCallback((screenOwnerId) => {
    setShapesByScreen((prev) => {
      const list = prev[screenOwnerId] || [];
      if (!list.length) return prev;
      const removed = list[list.length - 1];
      socket?.emit('annotation-undo', { roomId, screenOwnerId, shapeId: removed.id });
      return { ...prev, [screenOwnerId]: list.slice(0, -1) };
    });
  }, [socket, roomId]);

  const clearShapes = useCallback((screenOwnerId, { broadcast = true } = {}) => {
    setShapesByScreen((prev) => {
      if (!prev[screenOwnerId]?.length) return prev;
      return { ...prev, [screenOwnerId]: [] };
    });
    if (broadcast) socket?.emit('annotation-clear', { roomId, screenOwnerId });
  }, [socket, roomId]);

  // Local-only cleanup when a share ends (no broadcast needed — every
  // client independently reacts to its own 'peer-screen-share' / stop event).
  const removeScreen = useCallback((screenOwnerId) => {
    setShapesByScreen((prev) => {
      if (!(screenOwnerId in prev)) return prev;
      const next = { ...prev };
      delete next[screenOwnerId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onDraw = ({ screenOwnerId, shape }) => {
      setShapesByScreen((prev) => ({
        ...prev,
        [screenOwnerId]: [...(prev[screenOwnerId] || []), shape],
      }));
    };

    const onUndo = ({ screenOwnerId, shapeId }) => {
      setShapesByScreen((prev) => ({
        ...prev,
        [screenOwnerId]: (prev[screenOwnerId] || []).filter((s) => s.id !== shapeId),
      }));
    };

    const onClear = ({ screenOwnerId }) => {
      setShapesByScreen((prev) => ({ ...prev, [screenOwnerId]: [] }));
    };

    socket.on('annotation-draw', onDraw);
    socket.on('annotation-undo', onUndo);
    socket.on('annotation-clear', onClear);

    return () => {
      socket.off('annotation-draw', onDraw);
      socket.off('annotation-undo', onUndo);
      socket.off('annotation-clear', onClear);
    };
  }, [socket]);

  return { shapesByScreen, addShape, undoLastShape, clearShapes, removeScreen };
}
