import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BezierSegment,
  EllipseShape,
  LineShape,
  PathShape,
  Point,
  RectShape,
  ReferenceLayer,
  SnapResult,
  SplinePoint,
  SplineShape,
  VectorShape,
} from '../types/document';
import { useDocumentStore } from '../store/useDocumentStore';
import {
  distance,
  getMultiBoundingBox,
  getShapeBoundingBox,
  roundNum,
  scaleShape,
  segmentsToPathData,
  shapeToSvgPathData,
  splineToBezierSegments,
  translateShape,
} from '../engine/geometry';
import {
  applyShapeBuilderStroke,
  buildPlanarArrangement,
  hitTestArrangement,
} from '../engine/shapeBuilder';
import { computeSmartSnap } from '../engine/snapping';
import { sampleReferenceLayersAtPoint } from '../engine/pixelSampler';

export const CanvasViewport: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    doc,
    activeTool,
    activeStyle,
    zoom,
    panX,
    panY,
    setViewport,
    setSelectedShapeIds,
    addShape,
    updateShapeLive,
    updateShapesLive,
    updateReferenceLayerLive,
    saveHistorySnapshot,
    replaceShapesFromShapeBuilder,
    setActiveFill,
    setActiveStroke,
    setActiveTool,
    setStatusMessage,
  } = useDocumentStore();

  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isAltDown, setIsAltDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  // Cursor & Snap state
  const [cursorPos, setCursorPos] = useState<Point>({ x: 0, y: 0 });
  const [activeSnap, setActiveSnap] = useState<SnapResult>({
    point: { x: 0, y: 0 },
    snapped: false,
  });

  // Drawing state for Rect / Ellipse / Line
  const [dragDraw, setDragDraw] = useState<{
    start: Point;
    current: Point;
    shiftKey: boolean;
    altKey: boolean;
  } | null>(null);

  // Drawing state for Smooth Spline
  const [draftSplinePoints, setDraftSplinePoints] = useState<SplinePoint[]>([]);

  // Drawing state for Classic Bézier Pen
  const [draftPenSegments, setDraftPenSegments] = useState<BezierSegment[]>([]);
  const [isDraggingPenHandle, setIsDraggingPenHandle] = useState(false);

  // Select / Transform state
  const [transformDrag, setTransformDrag] = useState<{
    mode: 'move' | 'resize' | 'rotate' | 'marquee' | 'ref-move' | 'ref-resize';
    handle?: string;
    startPoint: Point;
    currentPoint: Point;
    initialBox?: { x: number; y: number; width: number; height: number; cx: number; cy: number };
    refLayerId?: string;
  } | null>(null);

  // Node Editor drag state
  const [nodeDrag, setNodeDrag] = useState<{
    shapeId: string;
    kind: 'spline-point' | 'path-anchor' | 'path-in' | 'path-out' | 'rect-rx';
    index: number;
  } | null>(null);

  // Shape Builder interactive state
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [sbBrushStroke, setSbBrushStroke] = useState<{
    trail: Point[];
    touchedFaceIds: string[];
    touchedEdgeIds: string[];
  } | null>(null);

  // Collect all unlocked visible shapes for snapping
  const allVisibleVectorShapes = useMemo(() => {
    const list: VectorShape[] = [];
    for (const layer of doc.layers) {
      if (layer.type === 'vector' && layer.visible) {
        for (const s of layer.shapes) {
          if (s.visible) list.push(s);
        }
      }
    }
    return list;
  }, [doc.layers]);

  // Candidate shapes for Shape Builder (selected shapes, or all unlocked shapes in active layer)
  const shapeBuilderCandidates = useMemo(() => {
    if (activeTool !== 'shape-builder') return [];
    const selectedSet = new Set(doc.selectedShapeIds);
    if (selectedSet.size > 0) {
      return allVisibleVectorShapes.filter(
        (s) => selectedSet.has(s.id) && !s.locked
      );
    }
    const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
    if (activeLayer && activeLayer.type === 'vector' && !activeLayer.locked) {
      return activeLayer.shapes.filter((s) => s.visible && !s.locked);
    }
    return allVisibleVectorShapes.filter((s) => !s.locked);
  }, [
    activeTool,
    doc.selectedShapeIds,
    doc.layers,
    doc.activeLayerId,
    allVisibleVectorShapes,
  ]);

  // Compute Planar Graph Arrangement for Shape Builder
  const planarArrangement = useMemo(() => {
    if (activeTool !== 'shape-builder' || shapeBuilderCandidates.length === 0) {
      return { faces: [], danglingEdges: [] };
    }
    return buildPlanarArrangement(
      shapeBuilderCandidates,
      doc.shapeBuilderOptions.gapTolerance
    );
  }, [
    activeTool,
    shapeBuilderCandidates,
    doc.shapeBuilderOptions.gapTolerance,
  ]);

  // Effective Shape Builder mode (holding Alt temporarily switches to Erase/Trim mode)
  const effectiveSbMode =
    isAltDown ? 'erase' : doc.shapeBuilderOptions.mode;

  // Convert screen coordinates to artboard coordinates
  const screenToCanvas = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top - panY) / zoom,
    };
  };

  // Finish active Spline or Pen path when pressing Enter/Escape or switching tools
  const commitDraftSpline = (closed = false) => {
    if (draftSplinePoints.length >= 2) {
      const newSpline: SplineShape = {
        id: `spline-${Date.now()}`,
        type: 'spline',
        name: closed ? 'Closed Spline' : 'Smooth Spline',
        visible: true,
        locked: false,
        points: draftSplinePoints,
        closed,
        tension: doc.splineToolOptions.tension,
        style: structuredClone(activeStyle),
        transform: { rotation: 0 },
      };
      addShape(newSpline, true);
      setStatusMessage(
        `Created ${closed ? 'closed' : 'open'} smooth spline (${draftSplinePoints.length} points)`
      );
    }
    setDraftSplinePoints([]);
  };

  const commitDraftPen = (closed = false) => {
    if (draftPenSegments.length >= 2) {
      const d = segmentsToPathData(draftPenSegments, closed);
      const newPath: PathShape = {
        id: `path-${Date.now()}`,
        type: 'path',
        name: closed ? 'Closed Bézier Path' : 'Bézier Path',
        visible: true,
        locked: false,
        d,
        segments: draftPenSegments,
        closed,
        style: structuredClone(activeStyle),
        transform: { rotation: 0 },
      };
      addShape(newPath, true);
      setStatusMessage(
        `Created ${closed ? 'closed' : 'open'} Bézier path (${draftPenSegments.length} anchors)`
      );
    }
    setDraftPenSegments([]);
    setIsDraggingPenHandle(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';

      if (e.key === 'Alt') setIsAltDown(true);
      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        setIsSpaceDown(true);
      }

      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useDocumentStore.getState().redo();
        } else {
          useDocumentStore.getState().undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useDocumentStore.getState().redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        useDocumentStore.getState().duplicateSelectedShapes();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        useDocumentStore.getState().selectAllInActiveLayer();
        return;
      }

      if (e.key === 'Enter' || e.key === 'Escape') {
        if (draftSplinePoints.length > 0) {
          commitDraftSpline(false);
          return;
        }
        if (draftPenSegments.length > 0) {
          commitDraftPen(false);
          return;
        }
        if (e.key === 'Escape') {
          setSelectedShapeIds([]);
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (draftSplinePoints.length === 0 && draftPenSegments.length === 0) {
          useDocumentStore.getState().deleteSelectedShapes();
        }
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setActiveTool('shape-builder');
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'a':
          setActiveTool('node');
          break;
        case 'r':
          setActiveTool('rect');
          break;
        case 'o':
          setActiveTool('ellipse');
          break;
        case 'l':
          setActiveTool('line');
          break;
        case 's':
          setActiveTool('spline');
          break;
        case 'p':
          setActiveTool('pen');
          break;
        case 'i':
          setActiveTool('eyedropper');
          break;
        case 't':
          setActiveTool('reference-transform');
          break;
        case 'h':
          setActiveTool('hand');
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltDown(false);
      if (e.code === 'Space') setIsSpaceDown(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });

  // Wheel Zoom / Pan
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = Math.max(0.1, Math.min(32, zoom * zoomFactor));
    const nextPanX = mouseX - ((mouseX - panX) / zoom) * nextZoom;
    const nextPanY = mouseY - ((mouseY - panY) / zoom) * nextZoom;
    setViewport(nextZoom, nextPanX, nextPanY);
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent) => {
    const rawPt = screenToCanvas(e.clientX, e.clientY);

    // Middle mouse or Spacebar or Hand tool -> Pan
    if (e.button === 1 || isSpaceDown || activeTool === 'hand') {
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX,
        panY,
      };
      return;
    }

    if (e.button !== 0) return;

    const snapRes = e.ctrlKey
      ? { point: rawPt, snapped: false }
      : computeSmartSnap(
          rawPt,
          allVisibleVectorShapes,
          doc.snapConfig,
          doc.gridSize,
          zoom,
          doc.selectedShapeIds,
          draftSplinePoints.length > 0
            ? [draftSplinePoints[0]]
            : draftPenSegments.length > 0
            ? [draftPenSegments[0].point]
            : []
        );
    const pt = snapRes.point;

    // 1. Eyedropper tool: check Reference PNGs if clicking outside a vector shape
    if (activeTool === 'eyedropper') {
      const refLayers = doc.layers.filter(
        (l): l is ReferenceLayer => l.type === 'reference'
      );
      const sampled = sampleReferenceLayersAtPoint(rawPt, refLayers);
      if (sampled) {
        if (e.shiftKey) {
          setActiveStroke({ color: sampled.color, opacity: sampled.opacity });
          setStatusMessage(
            `Sampled Stroke ${sampled.color} from Reference PNG "${sampled.layerName}"`
          );
        } else {
          setActiveFill({
            type: 'solid',
            color: sampled.color,
            opacity: sampled.opacity,
          });
          setStatusMessage(
            `Sampled Fill ${sampled.color} from Reference PNG "${sampled.layerName}"`
          );
        }
      }
      return;
    }

    // 2. Shape Builder Tool: start brush stroke
    if (activeTool === 'shape-builder') {
      const hit = hitTestArrangement(planarArrangement, rawPt, 8 / zoom);
      setSbBrushStroke({
        trail: [rawPt],
        touchedFaceIds: hit.faceId ? [hit.faceId] : [],
        touchedEdgeIds: hit.edgeId ? [hit.edgeId] : [],
      });
      return;
    }

    // 3. Smooth Spline Tool
    if (activeTool === 'spline') {
      if (draftSplinePoints.length >= 3) {
        const startPt = draftSplinePoints[0];
        if (
          distance(pt, startPt) <=
          doc.splineToolOptions.autoCloseDistance / zoom
        ) {
          commitDraftSpline(true);
          return;
        }
      }
      setDraftSplinePoints((prev) => [
        ...prev,
        { x: pt.x, y: pt.y, smooth: !e.altKey },
      ]);
      return;
    }

    // 4. Classic Bézier Pen Tool
    if (activeTool === 'pen') {
      if (draftPenSegments.length >= 2) {
        const startPt = draftPenSegments[0].point;
        if (distance(pt, startPt) <= 12 / zoom) {
          commitDraftPen(true);
          return;
        }
      }
      setDraftPenSegments((prev) => [
        ...prev,
        {
          point: { x: pt.x, y: pt.y },
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        },
      ]);
      setIsDraggingPenHandle(true);
      return;
    }

    // 5. Primitive Drawing (Rect, Ellipse, Line)
    if (
      activeTool === 'rect' ||
      activeTool === 'ellipse' ||
      activeTool === 'line'
    ) {
      setDragDraw({
        start: pt,
        current: pt,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      return;
    }

    // 6. Select Tool: Clicking empty canvas starts Marquee Selection
    if (activeTool === 'select') {
      if (!e.shiftKey) {
        setSelectedShapeIds([]);
      }
      setTransformDrag({
        mode: 'marquee',
        startPoint: rawPt,
        currentPoint: rawPt,
      });
    }
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent) => {
    const rawPt = screenToCanvas(e.clientX, e.clientY);
    setCursorPos(rawPt);

    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setViewport(zoom, panStartRef.current.panX + dx, panStartRef.current.panY + dy);
      return;
    }

    const snapRes = e.ctrlKey
      ? { point: rawPt, snapped: false }
      : computeSmartSnap(
          rawPt,
          allVisibleVectorShapes,
          doc.snapConfig,
          doc.gridSize,
          zoom,
          nodeDrag ? [nodeDrag.shapeId] : doc.selectedShapeIds,
          draftSplinePoints.length > 0
            ? [draftSplinePoints[0]]
            : draftPenSegments.length > 0
            ? [draftPenSegments[0].point]
            : []
        );
    setActiveSnap(snapRes);
    const pt = snapRes.point;

    // Shape Builder hover & brush trail
    if (activeTool === 'shape-builder') {
      const hit = hitTestArrangement(planarArrangement, rawPt, 8 / zoom);
      setHoveredFaceId(hit.faceId);
      setHoveredEdgeId(hit.edgeId);

      if (sbBrushStroke) {
        const lastPt =
          sbBrushStroke.trail[sbBrushStroke.trail.length - 1] || rawPt;
        const dist = distance(lastPt, rawPt);
        const steps = Math.max(1, Math.ceil(dist / 4));
        const newFaceIds = new Set(sbBrushStroke.touchedFaceIds);
        const newEdgeIds = new Set(sbBrushStroke.touchedEdgeIds);

        for (let s = 1; s <= steps; s++) {
          const samplePt = {
            x: lastPt.x + ((rawPt.x - lastPt.x) * s) / steps,
            y: lastPt.y + ((rawPt.y - lastPt.y) * s) / steps,
          };
          const stepHit = hitTestArrangement(
            planarArrangement,
            samplePt,
            8 / zoom
          );
          if (stepHit.faceId) newFaceIds.add(stepHit.faceId);
          if (stepHit.edgeId) newEdgeIds.add(stepHit.edgeId);
        }

        setSbBrushStroke({
          trail: [...sbBrushStroke.trail, rawPt],
          touchedFaceIds: Array.from(newFaceIds),
          touchedEdgeIds: Array.from(newEdgeIds),
        });
      }
      return;
    }

    // Dragging Pen tangent handle
    if (activeTool === 'pen' && isDraggingPenHandle && draftPenSegments.length > 0) {
      setDraftPenSegments((prev) => {
        const copy = [...prev];
        const lastIdx = copy.length - 1;
        const anchor = copy[lastIdx].point;
        const dx = pt.x - anchor.x;
        const dy = pt.y - anchor.y;
        copy[lastIdx] = {
          point: anchor,
          handleOut: { x: dx, y: dy },
          handleIn: e.altKey ? copy[lastIdx].handleIn : { x: -dx, y: -dy },
        };
        return copy;
      });
      return;
    }

    // Primitive drag-draw preview
    if (dragDraw) {
      setDragDraw({
        ...dragDraw,
        current: pt,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      return;
    }

    // Node Editor dragging
    if (nodeDrag) {
      updateShapeLive(nodeDrag.shapeId, (shape) => {
        if (nodeDrag.kind === 'rect-rx' && shape.type === 'rect') {
          const nextRx = Math.max(
            0,
            Math.min(shape.width / 2, shape.height / 2, pt.x - shape.x)
          );
          return { ...shape, rx: nextRx, ry: nextRx };
        }
        if (nodeDrag.kind === 'spline-point' && shape.type === 'spline') {
          const points = shape.points.map((p, idx) =>
            idx === nodeDrag.index ? { ...p, x: pt.x, y: pt.y } : p
          );
          return { ...shape, points };
        }
        if (shape.type === 'path') {
          const segments = shape.segments.map((seg, idx) => {
            if (idx !== nodeDrag.index) return seg;
            if (nodeDrag.kind === 'path-anchor') {
              return { ...seg, point: { x: pt.x, y: pt.y } };
            }
            if (nodeDrag.kind === 'path-in') {
              const hx = rawPt.x - seg.point.x;
              const hy = rawPt.y - seg.point.y;
              return {
                ...seg,
                handleIn: { x: hx, y: hy },
                handleOut: e.altKey ? seg.handleOut : { x: -hx, y: -hy },
              };
            }
            if (nodeDrag.kind === 'path-out') {
              const hx = rawPt.x - seg.point.x;
              const hy = rawPt.y - seg.point.y;
              return {
                ...seg,
                handleOut: { x: hx, y: hy },
                handleIn: e.altKey ? seg.handleIn : { x: -hx, y: -hy },
              };
            }
            return seg;
          });
          return {
            ...shape,
            segments,
            d: segmentsToPathData(segments, shape.closed, shape.compoundPaths),
          };
        }
        if (shape.type === 'line') {
          if (nodeDrag.index === 0) {
            return { ...shape, x1: pt.x, y1: pt.y };
          } else {
            return { ...shape, x2: pt.x, y2: pt.y };
          }
        }
        return shape;
      });
      return;
    }

    // Select / Transform dragging
    if (transformDrag) {
      if (transformDrag.mode === 'marquee') {
        setTransformDrag({ ...transformDrag, currentPoint: rawPt });
        return;
      }

      if (transformDrag.mode === 'move') {
        const dx = pt.x - transformDrag.currentPoint.x;
        const dy = pt.y - transformDrag.currentPoint.y;
        if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) {
          updateShapesLive(doc.selectedShapeIds, (s) => translateShape(s, dx, dy));
          setTransformDrag({ ...transformDrag, currentPoint: pt });
        }
        return;
      }

      if (transformDrag.mode === 'rotate' && transformDrag.initialBox) {
        const cx = transformDrag.initialBox.cx;
        const cy = transformDrag.initialBox.cy;
        let deg =
          (Math.atan2(rawPt.y - cy, rawPt.x - cx) * 180) / Math.PI + 90;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }
        updateShapesLive(doc.selectedShapeIds, (s) => ({
          ...s,
          transform: { rotation: roundNum(deg, 1) },
        }));
        return;
      }

      if (
        transformDrag.mode === 'resize' &&
        transformDrag.initialBox &&
        transformDrag.handle
      ) {
        const box = transformDrag.initialBox;
        const h = transformDrag.handle;
        let originX = box.x;
        let originY = box.y;
        let scaleX = 1;
        let scaleY = 1;

        if (h.includes('e')) {
          originX = box.x;
          scaleX = (pt.x - box.x) / Math.max(1, box.width);
        } else if (h.includes('w')) {
          originX = box.x + box.width;
          scaleX = (originX - pt.x) / Math.max(1, box.width);
        }

        if (h.includes('s')) {
          originY = box.y;
          scaleY = (pt.y - box.y) / Math.max(1, box.height);
        } else if (h.includes('n')) {
          originY = box.y + box.height;
          scaleY = (originY - pt.y) / Math.max(1, box.height);
        }

        if (e.shiftKey) {
          const uniform = Math.max(Math.abs(scaleX), Math.abs(scaleY));
          scaleX = Math.sign(scaleX || 1) * uniform;
          scaleY = Math.sign(scaleY || 1) * uniform;
        }

        // Incremental scaling relative to current box
        const selectedShapes = allVisibleVectorShapes.filter((s) =>
          doc.selectedShapeIds.includes(s.id)
        );
        const currBox = getMultiBoundingBox(selectedShapes);
        if (currBox) {
          const stepSx =
            h.includes('e') || h.includes('w')
              ? (box.width * scaleX) / Math.max(1, currBox.width)
              : 1;
          const stepSy =
            h.includes('s') || h.includes('n')
              ? (box.height * scaleY) / Math.max(1, currBox.height)
              : 1;
          updateShapesLive(doc.selectedShapeIds, (s) =>
            scaleShape(s, originX, originY, stepSx, stepSy)
          );
        }
        return;
      }

      if (transformDrag.mode === 'ref-move' && transformDrag.refLayerId) {
        const dx = rawPt.x - transformDrag.currentPoint.x;
        const dy = rawPt.y - transformDrag.currentPoint.y;
        const refLayer = doc.layers.find(
          (l): l is ReferenceLayer =>
            l.id === transformDrag.refLayerId && l.type === 'reference'
        );
        if (refLayer) {
          updateReferenceLayerLive(refLayer.id, {
            x: refLayer.x + dx,
            y: refLayer.y + dy,
          });
          setTransformDrag({ ...transformDrag, currentPoint: rawPt });
        }
        return;
      }

      if (
        transformDrag.mode === 'ref-resize' &&
        transformDrag.refLayerId &&
        transformDrag.initialBox
      ) {
        const box = transformDrag.initialBox;
        const newW = Math.max(20, rawPt.x - box.x);
        const ratio = box.height / Math.max(1, box.width);
        const newH = e.shiftKey
          ? Math.max(20, rawPt.y - box.y)
          : Math.round(newW * ratio);
        updateReferenceLayerLive(transformDrag.refLayerId, {
          width: Math.round(newW),
          height: Math.round(newH),
        });
        return;
      }
    }
  };

  // Pointer Up
  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDraggingPenHandle) {
      setIsDraggingPenHandle(false);
      return;
    }

    // Commit Shape Builder Stroke
    if (activeTool === 'shape-builder' && sbBrushStroke) {
      const { touchedFaceIds, touchedEdgeIds } = sbBrushStroke;
      setSbBrushStroke(null);

      if (touchedFaceIds.length > 0 || touchedEdgeIds.length > 0) {
        const nextShapes = applyShapeBuilderStroke({
          inputShapes: shapeBuilderCandidates,
          arrangement: planarArrangement,
          touchedFaceIds,
          touchedEdgeIds,
          mode: effectiveSbMode,
          styleMode: doc.shapeBuilderOptions.styleMode,
          activeStyle,
        });
        replaceShapesFromShapeBuilder(
          shapeBuilderCandidates.map((s) => s.id),
          nextShapes
        );
        setStatusMessage(
          effectiveSbMode === 'merge'
            ? `Shape Builder: Merged ${touchedFaceIds.length} region(s)`
            : `Shape Builder: Erased/trimmed ${touchedFaceIds.length} region(s) and ${touchedEdgeIds.length} segment(s)`
        );
      }
      return;
    }

    // Commit Primitive Draw (Rect, Ellipse, Line)
    if (dragDraw) {
      const { start, current, shiftKey, altKey } = dragDraw;
      setDragDraw(null);

      if (distance(start, current) < 3) return;

      if (activeTool === 'rect') {
        let w = Math.abs(current.x - start.x);
        let h = Math.abs(current.y - start.y);
        if (shiftKey) {
          const s = Math.max(w, h);
          w = s;
          h = s;
        }
        const x = altKey
          ? start.x - w
          : current.x >= start.x
          ? start.x
          : start.x - w;
        const y = altKey
          ? start.y - h
          : current.y >= start.y
          ? start.y
          : start.y - h;
        const rectShape: RectShape = {
          id: `rect-${Date.now()}`,
          type: 'rect',
          name: 'Rectangle',
          visible: true,
          locked: false,
          x: roundNum(x),
          y: roundNum(y),
          width: roundNum(altKey ? w * 2 : w),
          height: roundNum(altKey ? h * 2 : h),
          rx: 0,
          ry: 0,
          style: structuredClone(activeStyle),
          transform: { rotation: 0 },
        };
        addShape(rectShape, true);
      } else if (activeTool === 'ellipse') {
        let rx = Math.abs(current.x - start.x) / (altKey ? 1 : 2);
        let ry = Math.abs(current.y - start.y) / (altKey ? 1 : 2);
        if (shiftKey) {
          const r = Math.max(rx, ry);
          rx = r;
          ry = r;
        }
        const cx = altKey
          ? start.x
          : start.x + (current.x >= start.x ? rx : -rx);
        const cy = altKey
          ? start.y
          : start.y + (current.y >= start.y ? ry : -ry);
        const ellipseShape: EllipseShape = {
          id: `ellipse-${Date.now()}`,
          type: 'ellipse',
          name: Math.abs(rx - ry) < 1e-2 ? 'Circle' : 'Ellipse',
          visible: true,
          locked: false,
          cx: roundNum(cx),
          cy: roundNum(cy),
          rx: roundNum(rx),
          ry: roundNum(ry),
          style: structuredClone(activeStyle),
          transform: { rotation: 0 },
        };
        addShape(ellipseShape, true);
      } else if (activeTool === 'line') {
        let x2 = current.x;
        let y2 = current.y;
        if (shiftKey) {
          const dx = current.x - start.x;
          const dy = current.y - start.y;
          const len = Math.hypot(dx, dy);
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          x2 = start.x + Math.cos(angle) * len;
          y2 = start.y + Math.sin(angle) * len;
        }
        const lineShape: LineShape = {
          id: `line-${Date.now()}`,
          type: 'line',
          name: 'Line Segment',
          visible: true,
          locked: false,
          x1: roundNum(start.x),
          y1: roundNum(start.y),
          x2: roundNum(x2),
          y2: roundNum(y2),
          style: {
            ...structuredClone(activeStyle),
            fill: { type: 'none', color: '#000000', opacity: 0 },
          },
          transform: { rotation: 0 },
        };
        addShape(lineShape, true);
      }
      return;
    }

    if (nodeDrag) {
      setNodeDrag(null);
      return;
    }

    if (transformDrag) {
      if (transformDrag.mode === 'marquee') {
        const x1 = Math.min(
          transformDrag.startPoint.x,
          transformDrag.currentPoint.x
        );
        const y1 = Math.min(
          transformDrag.startPoint.y,
          transformDrag.currentPoint.y
        );
        const x2 = Math.max(
          transformDrag.startPoint.x,
          transformDrag.currentPoint.x
        );
        const y2 = Math.max(
          transformDrag.startPoint.y,
          transformDrag.currentPoint.y
        );
        if (x2 - x1 > 4 || y2 - y1 > 4) {
          const hits: string[] = [];
          for (const layer of doc.layers) {
            if (layer.type !== 'vector' || !layer.visible || layer.locked)
              continue;
            for (const s of layer.shapes) {
              if (!s.visible || s.locked) continue;
              const b = getShapeBoundingBox(s);
              const overlaps =
                b.x <= x2 &&
                b.x + b.width >= x1 &&
                b.y <= y2 &&
                b.y + b.height >= y1;
              if (overlaps) hits.push(s.id);
            }
          }
          setSelectedShapeIds(hits);
        }
      }
      setTransformDrag(null);
    }
  };

  //Selected shapes bounding box
  const selectedShapes = useMemo(() => {
    const idSet = new Set(doc.selectedShapeIds);
    return allVisibleVectorShapes.filter((s) => idSet.has(s.id));
  }, [doc.selectedShapeIds, allVisibleVectorShapes]);

  const selectionBox = useMemo(
    () => getMultiBoundingBox(selectedShapes),
    [selectedShapes]
  );

  // Render helper for Shape Fill & Stroke props
  const getSvgStyleProps = (shape: VectorShape) => {
    const { fill, stroke, opacity } = shape.style;
    let fillValue = 'none';
    if (fill.type === 'solid') {
      fillValue = fill.color;
    } else if (
      (fill.type === 'linear-gradient' || fill.type === 'radial-gradient') &&
      fill.gradientId
    ) {
      fillValue = `url(#${fill.gradientId})`;
    }

    return {
      fill: fillValue,
      fillOpacity: fill.type === 'none' ? 0 : fill.opacity,
      stroke: stroke.width > 0 ? stroke.color : 'none',
      strokeWidth: stroke.width,
      strokeOpacity: stroke.opacity,
      strokeLinecap: stroke.cap,
      strokeLinejoin: stroke.join,
      strokeDasharray:
        stroke.dashArray && stroke.dashArray.length > 0
          ? stroke.dashArray.join(' ')
          : undefined,
      opacity,
    };
  };

  // Shape click handler
  const handleShapePointerDown = (
    e: React.PointerEvent,
    shape: VectorShape,
    layerLocked: boolean
  ) => {
    if (isSpaceDown || activeTool === 'hand' || e.button !== 0) return;
    if (layerLocked || shape.locked) return;

    if (activeTool === 'eyedropper') {
      e.stopPropagation();
      if (e.shiftKey) {
        setActiveStroke({
          color: shape.style.stroke.color,
          opacity: shape.style.stroke.opacity,
        });
        setStatusMessage(`Sampled stroke color from "${shape.name}"`);
      } else if (shape.style.fill.type !== 'none') {
        setActiveFill({
          type: 'solid',
          color: shape.style.fill.color,
          opacity: shape.style.fill.opacity,
        });
        setStatusMessage(`Sampled fill color from "${shape.name}"`);
      } else {
        setActiveFill({
          type: 'solid',
          color: shape.style.stroke.color,
          opacity: 1,
        });
        setStatusMessage(`Sampled stroke color as fill from "${shape.name}"`);
      }
      return;
    }

    if (activeTool === 'select' || activeTool === 'node') {
      e.stopPropagation();
      const rawPt = screenToCanvas(e.clientX, e.clientY);
      const isSelected = doc.selectedShapeIds.includes(shape.id);

      if (e.shiftKey) {
        setSelectedShapeIds(
          isSelected
            ? doc.selectedShapeIds.filter((id) => id !== shape.id)
            : [...doc.selectedShapeIds, shape.id]
        );
      } else if (!isSelected) {
        setSelectedShapeIds([shape.id]);
      }

      if (activeTool === 'select') {
        saveHistorySnapshot();
        setTransformDrag({
          mode: 'move',
          startPoint: rawPt,
          currentPoint: rawPt,
        });
      }
    }
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => {
        if (activeTool === 'spline' && draftSplinePoints.length >= 2) {
          commitDraftSpline(false);
        } else if (activeTool === 'pen' && draftPenSegments.length >= 2) {
          commitDraftPen(false);
        }
      }}
      className={`flex-1 relative overflow-hidden bg-[#0b0d13] ${
        isPanning || isSpaceDown || activeTool === 'hand'
          ? 'cursor-grab active:cursor-grabbing'
          : activeTool === 'eyedropper' ||
            activeTool === 'spline' ||
            activeTool === 'pen' ||
            activeTool === 'rect' ||
            activeTool === 'ellipse' ||
            activeTool === 'line' ||
            activeTool === 'shape-builder'
          ? 'cursor-crosshair'
          : 'cursor-default'
      }`}
    >
      {/* Main Interactive SVG Scene */}
      <svg className="w-full h-full block">
        <defs>
          {/* Transparency Checkerboard Pattern */}
          <pattern
            id="studio-checkerboard"
            width={16}
            height={16}
            patternUnits="userSpaceOnUse"
          >
            <rect width={8} height={8} fill="#1e2230" />
            <rect x={8} width={8} height={8} fill="#161924" />
            <rect y={8} width={8} height={8} fill="#161924" />
            <rect x={8} y={8} width={8} height={8} fill="#1e2230" />
          </pattern>

          {/* Canvas Grid Pattern */}
          <pattern
            id="studio-grid"
            width={doc.gridSize}
            height={doc.gridSize}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${doc.gridSize} 0 L 0 0 0 ${doc.gridSize}`}
              fill="none"
              stroke="rgba(99, 102, 241, 0.14)"
              strokeWidth={1 / zoom}
            />
          </pattern>

          {/* Shape Builder Hover Hatch Pattern */}
          <pattern
            id="sb-merge-pattern"
            width={8 / zoom}
            height={8 / zoom}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={8 / zoom}
              stroke="#38bdf8"
              strokeWidth={2.5 / zoom}
            />
          </pattern>
          <pattern
            id="sb-erase-pattern"
            width={8 / zoom}
            height={8 / zoom}
            patternTransform="rotate(-45)"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={8 / zoom}
              stroke="#f43f5e"
              strokeWidth={2.5 / zoom}
            />
          </pattern>

          {/* Document Gradients */}
          {doc.gradients.map((grad) =>
            grad.type === 'linear' ? (
              <linearGradient
                key={grad.id}
                id={grad.id}
                x1={`${grad.x1 * 100}%`}
                y1={`${grad.y1 * 100}%`}
                x2={`${grad.x2 * 100}%`}
                y2={`${grad.y2 * 100}%`}
              >
                {grad.stops.map((s, idx) => (
                  <stop
                    key={idx}
                    offset={`${s.offset * 100}%`}
                    stopColor={s.color}
                    stopOpacity={s.opacity}
                  />
                ))}
              </linearGradient>
            ) : (
              <radialGradient key={grad.id} id={grad.id} cx="50%" cy="50%" r="50%">
                {grad.stops.map((s, idx) => (
                  <stop
                    key={idx}
                    offset={`${s.offset * 100}%`}
                    stopColor={s.color}
                    stopOpacity={s.opacity}
                  />
                ))}
              </radialGradient>
            )
          )}
        </defs>

        {/* Pan & Zoom Transform Group */}
        <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>
          {/* Artboard Shadow & Background */}
          <rect
            x={4}
            y={6}
            width={doc.width}
            height={doc.height}
            fill="rgba(0,0,0,0.5)"
            rx={2}
          />
          <rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            fill="url(#studio-checkerboard)"
          />
          {!doc.transparentBackground && (
            <rect
              x={0}
              y={0}
              width={doc.width}
              height={doc.height}
              fill={doc.backgroundColor}
            />
          )}
          {doc.showGrid && (
            <rect
              x={0}
              y={0}
              width={doc.width}
              height={doc.height}
              fill="url(#studio-grid)"
              pointerEvents="none"
            />
          )}
          <rect
            x={0}
            y={0}
            width={doc.width}
            height={doc.height}
            fill="none"
            stroke="#334155"
            strokeWidth={1 / zoom}
            pointerEvents="none"
          />

          {/* Render Layers in Stack Order */}
          {doc.layers.map((layer) => {
            if (!layer.visible) return null;

            if (layer.type === 'reference') {
              const cx = layer.x + layer.width / 2;
              const cy = layer.y + layer.height / 2;
              const canTransformRef =
                !layer.locked &&
                (activeTool === 'reference-transform' || activeTool === 'select');
              return (
                <g
                  key={layer.id}
                  opacity={layer.opacity}
                  transform={
                    layer.rotation ? `rotate(${layer.rotation} ${cx} ${cy})` : undefined
                  }
                >
                  <image
                    href={layer.dataUrl}
                    x={layer.x}
                    y={layer.y}
                    width={layer.width}
                    height={layer.height}
                    preserveAspectRatio="none"
                    style={{
                      pointerEvents: canTransformRef ? 'auto' : 'none',
                      cursor: canTransformRef ? 'move' : 'default',
                    }}
                    onPointerDown={(e) => {
                      if (!canTransformRef) return;
                      e.stopPropagation();
                      saveHistorySnapshot();
                      const rawPt = screenToCanvas(e.clientX, e.clientY);
                      setTransformDrag({
                        mode: 'ref-move',
                        refLayerId: layer.id,
                        startPoint: rawPt,
                        currentPoint: rawPt,
                      });
                    }}
                  />
                  {canTransformRef && (
                    <g>
                      <rect
                        x={layer.x}
                        y={layer.y}
                        width={layer.width}
                        height={layer.height}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={1.5 / zoom}
                        strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                        pointerEvents="none"
                      />
                      <rect
                        x={layer.x + layer.width - 5 / zoom}
                        y={layer.y + layer.height - 5 / zoom}
                        width={10 / zoom}
                        height={10 / zoom}
                        fill="#f59e0b"
                        stroke="#0f172a"
                        strokeWidth={1.5 / zoom}
                        style={{ cursor: 'nwse-resize' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          saveHistorySnapshot();
                          const rawPt = screenToCanvas(e.clientX, e.clientY);
                          setTransformDrag({
                            mode: 'ref-resize',
                            refLayerId: layer.id,
                            startPoint: rawPt,
                            currentPoint: rawPt,
                            initialBox: {
                              x: layer.x,
                              y: layer.y,
                              width: layer.width,
                              height: layer.height,
                              cx,
                              cy,
                            },
                          });
                        }}
                      />
                    </g>
                  )}
                </g>
              );
            }

            // Vector Layer
            return (
              <g key={layer.id} opacity={layer.opacity}>
                {layer.shapes.map((shape) => {
                  if (!shape.visible) return null;
                  const bbox = getShapeBoundingBox(shape);
                  const rot = shape.transform.rotation;
                  const transform = rot
                    ? `rotate(${rot} ${bbox.cx} ${bbox.cy})`
                    : undefined;
                  const styleProps = getSvgStyleProps(shape);
                  const commonEvents = {
                    onPointerDown: (e: React.PointerEvent) =>
                      handleShapePointerDown(e, shape, layer.locked),
                    onDoubleClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (!layer.locked && !shape.locked) {
                        if (activeTool === 'node' && shape.type === 'spline') {
                          const pt = screenToCanvas(e.clientX, e.clientY);
                          saveHistorySnapshot();
                          updateShapeLive(shape.id, (s) => {
                            if (s.type !== 'spline' || s.points.length < 2) return s;
                            let bestIdx = s.points.length;
                            let bestDist = Infinity;
                            const count = s.closed ? s.points.length : s.points.length - 1;
                            for (let i = 0; i < count; i++) {
                              const a = s.points[i];
                              const b = s.points[(i + 1) % s.points.length];
                              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                              const d = distance(pt, mid);
                              if (d < bestDist) {
                                bestDist = d;
                                bestIdx = i + 1;
                              }
                            }
                            const nextPts = [...s.points];
                            nextPts.splice(bestIdx, 0, {
                              x: roundNum(pt.x),
                              y: roundNum(pt.y),
                              smooth: true,
                            });
                            return { ...s, points: nextPts };
                          });
                          setStatusMessage('Inserted new pass-through point on spline');
                        } else {
                          setSelectedShapeIds([shape.id]);
                          setActiveTool('node');
                        }
                      }
                    },
                  };

                  if (shape.type === 'rect') {
                    return (
                      <rect
                        key={shape.id}
                        x={shape.x}
                        y={shape.y}
                        width={shape.width}
                        height={shape.height}
                        rx={shape.rx}
                        ry={shape.ry || shape.rx}
                        transform={transform}
                        {...styleProps}
                        {...commonEvents}
                      />
                    );
                  }
                  if (shape.type === 'ellipse') {
                    return (
                      <ellipse
                        key={shape.id}
                        cx={shape.cx}
                        cy={shape.cy}
                        rx={shape.rx}
                        ry={shape.ry}
                        transform={transform}
                        {...styleProps}
                        {...commonEvents}
                      />
                    );
                  }
                  if (shape.type === 'line') {
                    return (
                      <g key={shape.id} transform={transform} {...commonEvents}>
                        {/* Invisible wider hit-area for easy clicking on thin lines */}
                        <line
                          x1={shape.x1}
                          y1={shape.y1}
                          x2={shape.x2}
                          y2={shape.y2}
                          stroke="transparent"
                          strokeWidth={Math.max(10 / zoom, shape.style.stroke.width)}
                        />
                        <line
                          x1={shape.x1}
                          y1={shape.y1}
                          x2={shape.x2}
                          y2={shape.y2}
                          {...styleProps}
                        />
                      </g>
                    );
                  }
                  const d = shapeToSvgPathData(shape, false);
                  return (
                    <g key={shape.id} transform={transform} {...commonEvents}>
                      {shape.style.fill.type === 'none' && (
                        <path
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(10 / zoom, shape.style.stroke.width)}
                        />
                      )}
                      <path d={d} {...styleProps} />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* ================= SHAPE BUILDER PLANAR OVERLAY ================= */}
          {activeTool === 'shape-builder' && (
            <g pointerEvents="none">
              {/* Render all detected enclosed faces */}
              {planarArrangement.faces.map((face) => {
                const isTouched =
                  sbBrushStroke?.touchedFaceIds.includes(face.id) || false;
                const isHovered = hoveredFaceId === face.id;
                const isActive = isTouched || isHovered;
                return (
                  <path
                    key={face.id}
                    d={face.d}
                    fillRule="evenodd"
                    fill={
                      isActive
                        ? effectiveSbMode === 'merge'
                          ? 'url(#sb-merge-pattern)'
                          : 'url(#sb-erase-pattern)'
                        : 'rgba(56, 189, 248, 0.06)'
                    }
                    stroke={
                      isActive
                        ? effectiveSbMode === 'merge'
                          ? '#38bdf8'
                          : '#f43f5e'
                        : 'rgba(148, 163, 184, 0.5)'
                    }
                    strokeWidth={(isActive ? 2.2 : 1) / zoom}
                    strokeDasharray={
                      isActive ? undefined : `${3 / zoom} ${3 / zoom}`
                    }
                  />
                );
              })}

              {/* Render all dangling open line/spline edges (highlighted for trimming!) */}
              {planarArrangement.danglingEdges.map((edge) => {
                const isTouched =
                  sbBrushStroke?.touchedEdgeIds.includes(edge.id) || false;
                const isHovered = hoveredEdgeId === edge.id;
                const isActive = isTouched || isHovered;
                return (
                  <path
                    key={edge.id}
                    d={edge.d}
                    fill="none"
                    stroke={
                      isActive
                        ? '#f43f5e'
                        : effectiveSbMode === 'erase'
                        ? 'rgba(244, 63, 94, 0.55)'
                        : 'rgba(251, 191, 36, 0.5)'
                    }
                    strokeWidth={(isActive ? 4.5 : 2) / zoom}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                  />
                );
              })}

              {/* Active Brush Trail */}
              {sbBrushStroke && sbBrushStroke.trail.length > 1 && (
                <polyline
                  points={sbBrushStroke.trail
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke={effectiveSbMode === 'merge' ? '#38bdf8' : '#f43f5e'}
                  strokeWidth={3 / zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Cursor Mode Badge (+ Merge / - Erase) */}
              <g
                transform={`translate(${cursorPos.x + 12 / zoom}, ${
                  cursorPos.y - 12 / zoom
                })`}
              >
                <circle
                  r={9 / zoom}
                  fill={effectiveSbMode === 'merge' ? '#0284c7' : '#e11d48'}
                  stroke="#ffffff"
                  strokeWidth={1.5 / zoom}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  fontSize={12 / zoom}
                  fontWeight="bold"
                >
                  {effectiveSbMode === 'merge' ? '+' : '−'}
                </text>
              </g>
            </g>
          )}

          {/* ================= LIVE DRAWING PREVIEWS ================= */}
          {dragDraw && activeTool === 'rect' && (
            <rect
              x={
                dragDraw.altKey
                  ? dragDraw.start.x - Math.abs(dragDraw.current.x - dragDraw.start.x)
                  : Math.min(dragDraw.start.x, dragDraw.current.x)
              }
              y={
                dragDraw.altKey
                  ? dragDraw.start.y - Math.abs(dragDraw.current.y - dragDraw.start.y)
                  : Math.min(dragDraw.start.y, dragDraw.current.y)
              }
              width={
                Math.abs(dragDraw.current.x - dragDraw.start.x) *
                (dragDraw.altKey ? 2 : 1)
              }
              height={
                Math.abs(dragDraw.current.y - dragDraw.start.y) *
                (dragDraw.altKey ? 2 : 1)
              }
              fill="rgba(99, 102, 241, 0.2)"
              stroke="#6366f1"
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
              pointerEvents="none"
            />
          )}

          {dragDraw && activeTool === 'ellipse' && (
            <ellipse
              cx={
                dragDraw.altKey
                  ? dragDraw.start.x
                  : (dragDraw.start.x + dragDraw.current.x) / 2
              }
              cy={
                dragDraw.altKey
                  ? dragDraw.start.y
                  : (dragDraw.start.y + dragDraw.current.y) / 2
              }
              rx={
                Math.abs(dragDraw.current.x - dragDraw.start.x) /
                (dragDraw.altKey ? 1 : 2)
              }
              ry={
                Math.abs(dragDraw.current.y - dragDraw.start.y) /
                (dragDraw.altKey ? 1 : 2)
              }
              fill="rgba(99, 102, 241, 0.2)"
              stroke="#6366f1"
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
              pointerEvents="none"
            />
          )}

          {dragDraw && activeTool === 'line' && (
            <line
              x1={dragDraw.start.x}
              y1={dragDraw.start.y}
              x2={dragDraw.current.x}
              y2={dragDraw.current.y}
              stroke="#6366f1"
              strokeWidth={2 / zoom}
              strokeDasharray={`${4 / zoom} ${4 / zoom}`}
              pointerEvents="none"
            />
          )}

          {/* Live Smooth Spline Preview */}
          {activeTool === 'spline' && draftSplinePoints.length > 0 && (
            <g pointerEvents="none">
              <path
                d={segmentsToPathData(
                  splineToBezierSegments(
                    [
                      ...draftSplinePoints,
                      {
                        x: activeSnap.point.x,
                        y: activeSnap.point.y,
                        smooth: !isAltDown,
                      },
                    ],
                    false,
                    doc.splineToolOptions.tension
                  ),
                  false
                )}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2 / zoom}
              />
              {draftSplinePoints.map((pt, idx) => (
                <circle
                  key={idx}
                  cx={pt.x}
                  cy={pt.y}
                  r={(idx === 0 ? 5.5 : 4) / zoom}
                  fill={idx === 0 ? '#22c55e' : '#38bdf8'}
                  stroke="#0f172a"
                  strokeWidth={1.5 / zoom}
                />
              ))}
            </g>
          )}

          {/* Live Classic Bézier Pen Preview */}
          {activeTool === 'pen' && draftPenSegments.length > 0 && (
            <g pointerEvents="none">
              <path
                d={segmentsToPathData(
                  [
                    ...draftPenSegments,
                    {
                      point: activeSnap.point,
                      handleIn: { x: 0, y: 0 },
                      handleOut: { x: 0, y: 0 },
                    },
                  ],
                  false
                )}
                fill="none"
                stroke="#a855f7"
                strokeWidth={2 / zoom}
              />
              {draftPenSegments.map((seg, idx) => (
                <g key={idx}>
                  <line
                    x1={seg.point.x + seg.handleIn.x}
                    y1={seg.point.y + seg.handleIn.y}
                    x2={seg.point.x + seg.handleOut.x}
                    y2={seg.point.y + seg.handleOut.y}
                    stroke="#c084fc"
                    strokeWidth={1 / zoom}
                  />
                  <rect
                    x={seg.point.x - 3.5 / zoom}
                    y={seg.point.y - 3.5 / zoom}
                    width={7 / zoom}
                    height={7 / zoom}
                    fill={idx === 0 ? '#22c55e' : '#a855f7'}
                    stroke="#ffffff"
                    strokeWidth={1 / zoom}
                  />
                </g>
              ))}
            </g>
          )}

          {/* ================= SELECT BOUNDING BOX & HANDLES ================= */}
          {activeTool === 'select' && selectionBox && (
            <g>
              <rect
                x={selectionBox.x}
                y={selectionBox.y}
                width={selectionBox.width}
                height={selectionBox.height}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5 / zoom}
                pointerEvents="none"
              />
              {/* Rotation Handle */}
              <line
                x1={selectionBox.cx}
                y1={selectionBox.y}
                x2={selectionBox.cx}
                y2={selectionBox.y - 20 / zoom}
                stroke="#6366f1"
                strokeWidth={1.5 / zoom}
                pointerEvents="none"
              />
              <circle
                cx={selectionBox.cx}
                cy={selectionBox.y - 20 / zoom}
                r={5 / zoom}
                fill="#ffffff"
                stroke="#6366f1"
                strokeWidth={2 / zoom}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  saveHistorySnapshot();
                  const rawPt = screenToCanvas(e.clientX, e.clientY);
                  setTransformDrag({
                    mode: 'rotate',
                    startPoint: rawPt,
                    currentPoint: rawPt,
                    initialBox: selectionBox,
                  });
                }}
              />

              {/* 8 Resize Handles */}
              {[
                { id: 'nw', x: selectionBox.x, y: selectionBox.y },
                { id: 'n', x: selectionBox.cx, y: selectionBox.y },
                {
                  id: 'ne',
                  x: selectionBox.x + selectionBox.width,
                  y: selectionBox.y,
                },
                {
                  id: 'e',
                  x: selectionBox.x + selectionBox.width,
                  y: selectionBox.cy,
                },
                {
                  id: 'se',
                  x: selectionBox.x + selectionBox.width,
                  y: selectionBox.y + selectionBox.height,
                },
                {
                  id: 's',
                  x: selectionBox.cx,
                  y: selectionBox.y + selectionBox.height,
                },
                {
                  id: 'sw',
                  x: selectionBox.x,
                  y: selectionBox.y + selectionBox.height,
                },
                { id: 'w', x: selectionBox.x, y: selectionBox.cy },
              ].map((h) => (
                <rect
                  key={h.id}
                  x={h.x - 4 / zoom}
                  y={h.y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill="#ffffff"
                  stroke="#6366f1"
                  strokeWidth={1.5 / zoom}
                  style={{ cursor: `${h.id}-resize` }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    saveHistorySnapshot();
                    const rawPt = screenToCanvas(e.clientX, e.clientY);
                    setTransformDrag({
                      mode: 'resize',
                      handle: h.id,
                      startPoint: rawPt,
                      currentPoint: rawPt,
                      initialBox: selectionBox,
                    });
                  }}
                />
              ))}
            </g>
          )}

          {/* ================= NODE / DIRECT SELECTION OVERLAY ================= */}
          {activeTool === 'node' &&
            selectedShapes.map((shape) => {
              if (shape.type === 'rect') {
                return (
                  <g key={`node-${shape.id}`}>
                    <circle
                      cx={shape.x + Math.max(8, shape.rx)}
                      cy={shape.y + 8}
                      r={5 / zoom}
                      fill="#38bdf8"
                      stroke="#0f172a"
                      strokeWidth={1.5 / zoom}
                      style={{ cursor: 'ew-resize' }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        saveHistorySnapshot();
                        setNodeDrag({
                          shapeId: shape.id,
                          kind: 'rect-rx',
                          index: 0,
                        });
                      }}
                    >
                      <title>Drag to adjust rectangle corner radius (rx)</title>
                    </circle>
                  </g>
                );
              }

              if (shape.type === 'line') {
                return (
                  <g key={`node-${shape.id}`}>
                    {[
                      { x: shape.x1, y: shape.y1, idx: 0 },
                      { x: shape.x2, y: shape.y2, idx: 1 },
                    ].map((pt) => (
                      <circle
                        key={pt.idx}
                        cx={pt.x}
                        cy={pt.y}
                        r={5 / zoom}
                        fill="#38bdf8"
                        stroke="#0f172a"
                        strokeWidth={1.5 / zoom}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          saveHistorySnapshot();
                          setNodeDrag({
                            shapeId: shape.id,
                            kind: 'spline-point',
                            index: pt.idx,
                          });
                        }}
                      />
                    ))}
                  </g>
                );
              }

              if (shape.type === 'spline') {
                return (
                  <g key={`node-${shape.id}`}>
                    {shape.points.map((pt, idx) => (
                      <g key={idx}>
                        {pt.smooth ? (
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={5 / zoom}
                            fill="#38bdf8"
                            stroke="#ffffff"
                            strokeWidth={1.5 / zoom}
                            style={{ cursor: 'move' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              saveHistorySnapshot();
                              if (e.altKey) {
                                // Toggle smooth vs sharp corner
                                updateShapeLive(shape.id, (s) => {
                                  if (s.type !== 'spline') return s;
                                  return {
                                    ...s,
                                    points: s.points.map((p, i) =>
                                      i === idx ? { ...p, smooth: !p.smooth } : p
                                    ),
                                  };
                                });
                                return;
                              }
                              setNodeDrag({
                                shapeId: shape.id,
                                kind: 'spline-point',
                                index: idx,
                              });
                            }}
                          />
                        ) : (
                          <rect
                            x={pt.x - 4.5 / zoom}
                            y={pt.y - 4.5 / zoom}
                            width={9 / zoom}
                            height={9 / zoom}
                            fill="#f59e0b"
                            stroke="#ffffff"
                            strokeWidth={1.5 / zoom}
                            style={{ cursor: 'move' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              saveHistorySnapshot();
                              if (e.altKey) {
                                updateShapeLive(shape.id, (s) => {
                                  if (s.type !== 'spline') return s;
                                  return {
                                    ...s,
                                    points: s.points.map((p, i) =>
                                      i === idx ? { ...p, smooth: !p.smooth } : p
                                    ),
                                  };
                                });
                                return;
                              }
                              setNodeDrag({
                                shapeId: shape.id,
                                kind: 'spline-point',
                                index: idx,
                              });
                            }}
                          />
                        )}
                      </g>
                    ))}
                  </g>
                );
              }

              if (shape.type === 'path') {
                return (
                  <g key={`node-${shape.id}`}>
                    {shape.segments.map((seg, idx) => {
                      const inX = seg.point.x + seg.handleIn.x;
                      const inY = seg.point.y + seg.handleIn.y;
                      const outX = seg.point.x + seg.handleOut.x;
                      const outY = seg.point.y + seg.handleOut.y;
                      return (
                        <g key={idx}>
                          {/* Handle In */}
                          {(Math.abs(seg.handleIn.x) > 0.5 ||
                            Math.abs(seg.handleIn.y) > 0.5) && (
                            <>
                              <line
                                x1={seg.point.x}
                                y1={seg.point.y}
                                x2={inX}
                                y2={inY}
                                stroke="#a855f7"
                                strokeWidth={1.2 / zoom}
                              />
                              <circle
                                cx={inX}
                                cy={inY}
                                r={3.5 / zoom}
                                fill="#a855f7"
                                stroke="#ffffff"
                                strokeWidth={1 / zoom}
                                style={{ cursor: 'pointer' }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  saveHistorySnapshot();
                                  setNodeDrag({
                                    shapeId: shape.id,
                                    kind: 'path-in',
                                    index: idx,
                                  });
                                }}
                              />
                            </>
                          )}
                          {/* Handle Out */}
                          {(Math.abs(seg.handleOut.x) > 0.5 ||
                            Math.abs(seg.handleOut.y) > 0.5) && (
                            <>
                              <line
                                x1={seg.point.x}
                                y1={seg.point.y}
                                x2={outX}
                                y2={outY}
                                stroke="#a855f7"
                                strokeWidth={1.2 / zoom}
                              />
                              <circle
                                cx={outX}
                                cy={outY}
                                r={3.5 / zoom}
                                fill="#a855f7"
                                stroke="#ffffff"
                                strokeWidth={1 / zoom}
                                style={{ cursor: 'pointer' }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  saveHistorySnapshot();
                                  setNodeDrag({
                                    shapeId: shape.id,
                                    kind: 'path-out',
                                    index: idx,
                                  });
                                }}
                              />
                            </>
                          )}
                          {/* Anchor Point */}
                          <rect
                            x={seg.point.x - 4 / zoom}
                            y={seg.point.y - 4 / zoom}
                            width={8 / zoom}
                            height={8 / zoom}
                            fill="#ffffff"
                            stroke="#6366f1"
                            strokeWidth={1.8 / zoom}
                            style={{ cursor: 'move' }}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              saveHistorySnapshot();
                              setNodeDrag({
                                shapeId: shape.id,
                                kind: 'path-anchor',
                                index: idx,
                              });
                            }}
                          />
                        </g>
                      );
                    })}
                  </g>
                );
              }
              return null;
            })}

          {/* Marquee Selection Box */}
          {transformDrag?.mode === 'marquee' && (
            <rect
              x={Math.min(
                transformDrag.startPoint.x,
                transformDrag.currentPoint.x
              )}
              y={Math.min(
                transformDrag.startPoint.y,
                transformDrag.currentPoint.y
              )}
              width={Math.abs(
                transformDrag.currentPoint.x - transformDrag.startPoint.x
              )}
              height={Math.abs(
                transformDrag.currentPoint.y - transformDrag.startPoint.y
              )}
              fill="rgba(99, 102, 241, 0.12)"
              stroke="#6366f1"
              strokeWidth={1 / zoom}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
              pointerEvents="none"
            />
          )}

          {/* ================= SMART SNAP INDICATOR OVERLAY ================= */}
          {activeSnap.snapped && (
            <g pointerEvents="none">
              {activeSnap.guideLine && (
                <line
                  x1={activeSnap.guideLine.x1}
                  y1={activeSnap.guideLine.y1}
                  x2={activeSnap.guideLine.x2}
                  y2={activeSnap.guideLine.y2}
                  stroke="#ec4899"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                />
              )}
              <circle
                cx={activeSnap.point.x}
                cy={activeSnap.point.y}
                r={5 / zoom}
                fill="none"
                stroke="#ec4899"
                strokeWidth={2 / zoom}
              />
              {activeSnap.label && (
                <text
                  x={activeSnap.point.x + 8 / zoom}
                  y={activeSnap.point.y - 8 / zoom}
                  fill="#f472b6"
                  fontSize={10 / zoom}
                  fontWeight="bold"
                >
                  {activeSnap.label}
                </text>
              )}
            </g>
          )}
        </g>
      </svg>

      {/* Bottom Floating HUD Status Bar */}
      <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between pointer-events-none text-[11px]">
        <div className="bg-[#13161f]/90 backdrop-blur border border-[#252a3a] px-3 py-1 rounded-md text-slate-300 shadow">
          {useDocumentStore.getState().statusMessage}
        </div>
        <div className="bg-[#13161f]/90 backdrop-blur border border-[#252a3a] px-2.5 py-1 rounded-md text-slate-400 font-mono shadow">
          X: {Math.round(cursorPos.x)} Y: {Math.round(cursorPos.y)}
          {activeTool === 'shape-builder' && (
            <span className="ml-2 text-indigo-400">
              • {planarArrangement.faces.length} regions,{' '}
              {planarArrangement.danglingEdges.length} open segments
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
