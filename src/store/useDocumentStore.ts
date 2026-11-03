import { create } from 'zustand';
import {
  DocumentState,
  FillStyle,
  GradientDef,
  LayerItem,
  ReferenceLayer,
  ShapeBuilderOptions,
  ShapeStyle,
  SnapConfig,
  SplineToolOptions,
   StrokeStyle,
  ToolType,
  VectorLayer,
  VectorShape,
} from '../types/document';
import {
  getMultiBoundingBox,
  getShapeBoundingBox,
  shapeToPathShape,
  translateShape,
} from '../engine/geometry';
import { performBooleanOperation } from '../engine/shapeBuilder';
import { preloadReferenceLayerForSampling } from '../engine/pixelSampler';

const DEFAULT_GRADIENTS: GradientDef[] = [
  {
    id: 'grad-devil-fruit',
    name: 'Devil Fruit Violet',
    type: 'linear',
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    stops: [
      { offset: 0, color: '#6366f1', opacity: 1 },
      { offset: 1, color: '#a855f7', opacity: 1 },
    ],
  },
  {
    id: 'grad-ocean-breeze',
    name: 'Grand Line Cyan',
    type: 'linear',
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    stops: [
      { offset: 0, color: '#06b6d4', opacity: 1 },
      { offset: 1, color: '#3b82f6', opacity: 1 },
    ],
  },
  {
    id: 'grad-sun-god',
    name: 'Solar Flare Radial',
    type: 'radial',
    x1: 0.5,
    y1: 0.5,
    x2: 1,
    y2: 1,
    stops: [
      { offset: 0, color: '#fde047', opacity: 1 },
      { offset: 1, color: '#f97316', opacity: 1 },
    ],
  },
];

export function createStarterDocument(withDemoShapes = true): DocumentState {
  const layerId = 'layer-main-1';
  const demoShapes: VectorShape[] = withDemoShapes
    ? [
        {
          id: 'demo-circle-left',
          type: 'ellipse',
          name: 'Left Circle',
          visible: true,
          locked: false,
          cx: 430,
          cy: 340,
          rx: 115,
          ry: 115,
          transform: { rotation: 0 },
          style: {
            fill: { type: 'solid', color: '#6366f1', opacity: 0.85 },
            stroke: {
              color: '#1e1b4b',
              width: 2.5,
              opacity: 1,
              cap: 'round',
              join: 'round',
              dashArray: [],
            },
            opacity: 1,
          },
        },
        {
          id: 'demo-circle-right',
          type: 'ellipse',
          name: 'Right Circle',
          visible: true,
          locked: false,
          cx: 555,
          cy: 340,
          rx: 115,
          ry: 115,
          transform: { rotation: 0 },
          style: {
            fill: { type: 'solid', color: '#06b6d4', opacity: 0.85 },
            stroke: {
              color: '#1e1b4b',
              width: 2.5,
              opacity: 1,
              cap: 'round',
              join: 'round',
              dashArray: [],
            },
            opacity: 1,
          },
        },
        {
          id: 'demo-spline-wave',
          type: 'spline',
          name: 'Bisecting Smooth Spline',
          visible: true,
          locked: false,
          closed: false,
          tension: 0.5,
          points: [
            { x: 270, y: 355, smooth: true },
            { x: 410, y: 275, smooth: true },
            { x: 575, y: 405, smooth: true },
            { x: 715, y: 320, smooth: true },
          ],
          transform: { rotation: 0 },
          style: {
            fill: { type: 'none', color: '#000000', opacity: 0 },
            stroke: {
              color: '#f43f5e',
              width: 3,
              opacity: 1,
              cap: 'round',
              join: 'round',
              dashArray: [],
            },
            opacity: 1,
          },
        },
      ]
    : [];

  return {
    id: `doc-${Date.now()}`,
    name: 'Untitled Illustration',
    width: 1000,
    height: 700,
    backgroundColor: '#ffffff',
    transparentBackground: false,
    showGrid: true,
    gridSize: 20,
    layers: [
      {
        id: layerId,
        type: 'vector',
        name: 'Vector Layer 1',
        visible: true,
        locked: false,
        opacity: 1,
        expanded: true,
        shapes: demoShapes,
      },
    ],
    activeLayerId: layerId,
    selectedShapeIds: [],
    gradients: structuredClone(DEFAULT_GRADIENTS),
    snapConfig: {
      enabled: true,
      snapToAnchors: true,
      snapToCurves: true,
      snapToIntersections: true,
      snapToCenters: true,
      snapToGrid: false,
      snapTolerance: 10,
    },
    shapeBuilderOptions: {
      mode: 'merge',
      gapTolerance: 4,
      styleMode: 'active-or-inherit',
    },
    splineToolOptions: {
      tension: 0.5,
      autoCloseDistance: 12,
    },
  };
}

interface DocumentStore {
  doc: DocumentState;
  past: DocumentState[];
  future: DocumentState[];
  activeTool: ToolType;
  activeStyle: ShapeStyle;
  zoom: number;
  panX: number;
  panY: number;
  statusMessage: string;

  // Actions
  setActiveTool: (tool: ToolType) => void;
  setStatusMessage: (msg: string) => void;
  setViewport: (zoom: number, panX: number, panY: number) => void;
  resetViewport: () => void;

  // History
  saveHistorySnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Document settings
  newDocument: (withDemoShapes?: boolean) => void;
  loadDocument: (doc: DocumentState) => void;
  updateDocumentMeta: (
    patch: Partial<
      Pick<
        DocumentState,
        | 'name'
        | 'width'
        | 'height'
        | 'backgroundColor'
        | 'transparentBackground'
        | 'showGrid'
        | 'gridSize'
      >
    >
  ) => void;
  updateSnapConfig: (patch: Partial<SnapConfig>) => void;
  updateShapeBuilderOptions: (patch: Partial<ShapeBuilderOptions>) => void;
  updateSplineToolOptions: (patch: Partial<SplineToolOptions>) => void;

  // Selection
  setSelectedShapeIds: (ids: string[]) => void;
  selectAllInActiveLayer: () => void;

  // Styling
  setActiveFill: (patch: Partial<FillStyle>) => void;
  setActiveStroke: (patch: Partial<StrokeStyle>) => void;
  setActiveOpacity: (opacity: number) => void;
  applyStyleToSelected: (updater: (prev: ShapeStyle) => ShapeStyle) => void;
  addOrUpdateGradient: (grad: GradientDef) => void;

  // Shape CRUD
  addShape: (shape: VectorShape, selectIt?: boolean) => void;
  updateShapeLive: (
    shapeId: string,
    updater: (shape: VectorShape) => VectorShape
  ) => void;
  updateShapesLive: (
    shapeIds: string[],
    updater: (shape: VectorShape) => VectorShape
  ) => void;
  deleteSelectedShapes: () => void;
  duplicateSelectedShapes: () => void;
  convertSelectedToPaths: () => void;
  toggleShapeVisibility: (shapeId: string) => void;
  toggleShapeLock: (shapeId: string) => void;
  renameShape: (shapeId: string, name: string) => void;
  reorderShapeInLayer: (
    layerId: string,
    shapeId: string,
    direction: 'up' | 'down' | 'top' | 'bottom'
  ) => void;

  // Alignment & Boolean & Shape Builder
  alignSelectedShapes: (
    mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ) => void;
  booleanSelectedShapes: (
    op: 'unite' | 'subtract' | 'intersect' | 'exclude'
  ) => void;
  replaceShapesFromShapeBuilder: (
    sourceShapeIds: string[],
    newShapes: VectorShape[]
  ) => void;

  // Layers & Reference PNGs
  setActiveLayerId: (id: string) => void;
  addVectorLayer: (name?: string) => string;
  addReferenceLayer: (params: {
    name: string;
    dataUrl: string;
    width: number;
    height: number;
  }) => string;
  updateReferenceLayerLive: (
    layerId: string,
    patch: Partial<ReferenceLayer>
  ) => void;
  deleteLayer: (layerId: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerLock: (layerId: string) => void;
  toggleLayerExpanded: (layerId: string) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  renameLayer: (layerId: string, name: string) => void;
  reorderLayer: (
    layerId: string,
    direction: 'up' | 'down'
  ) => void;
  importVectorLayers: (
    layers: VectorLayer[],
    gradients: GradientDef[],
    replaceDocument?: boolean,
    width?: number,
    height?: number
  ) => void;
}

const MAX_HISTORY = 50;

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  doc: createStarterDocument(true),
  past: [],
  future: [],
  activeTool: 'select',
  activeStyle: {
    fill: { type: 'solid', color: '#6366f1', opacity: 0.9 },
    stroke: {
      color: '#1e1b4b',
      width: 2.5,
      opacity: 1,
      cap: 'round',
      join: 'round',
      dashArray: [],
    },
    opacity: 1,
  },
  zoom: 0.9,
  panX: 80,
  panY: 40,
  statusMessage:
    'Ready — Try selecting the Shape Builder (Shift+M) and dragging across the overlapping circles & spline!',

  setActiveTool: (tool) => set({ activeTool: tool }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setViewport: (zoom, panX, panY) =>
    set({
      zoom: Math.max(0.1, Math.min(32, zoom)),
      panX,
      panY,
    }),
  resetViewport: () => set({ zoom: 0.9, panX: 80, panY: 40 }),

  saveHistorySnapshot: () => {
    const current = structuredClone(get().doc);
    set((state) => ({
      past: [...state.past.slice(-(MAX_HISTORY - 1)), current],
      future: [],
    }));
  },

  undo: () => {
    const { past, doc, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      doc: previous,
      past: past.slice(0, -1),
      future: [structuredClone(doc), ...future.slice(0, MAX_HISTORY - 1)],
      statusMessage: 'Undid last action',
    });
  },

  redo: () => {
    const { past, doc, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      doc: next,
      past: [...past, structuredClone(doc)],
      future: future.slice(1),
      statusMessage: 'Redid action',
    });
  },

  newDocument: (withDemoShapes = false) => {
    get().saveHistorySnapshot();
    set({
      doc: createStarterDocument(withDemoShapes),
      activeTool: 'select',
      statusMessage: withDemoShapes
        ? 'Loaded demo shapes for Shape Builder & Spline testing'
        : 'Created new blank canvas',
    });
  },

  loadDocument: (newDoc) => {
    newDoc.layers.forEach((l) => {
      if (l.type === 'reference') {
        preloadReferenceLayerForSampling(l);
      }
    });
    set({
      doc: newDoc,
      past: [],
      future: [],
      activeTool: 'select',
      statusMessage: `Loaded "${newDoc.name}"`,
    });
  },

  updateDocumentMeta: (patch) =>
    set((state) => ({
      doc: { ...state.doc, ...patch },
    })),

  updateSnapConfig: (patch) =>
    set((state) => ({
      doc: {
        ...state.doc,
        snapConfig: { ...state.doc.snapConfig, ...patch },
      },
    })),

  updateShapeBuilderOptions: (patch) =>
    set((state) => ({
      doc: {
        ...state.doc,
        shapeBuilderOptions: { ...state.doc.shapeBuilderOptions, ...patch },
      },
    })),

  updateSplineToolOptions: (patch) =>
    set((state) => ({
      doc: {
        ...state.doc,
        splineToolOptions: { ...state.doc.splineToolOptions, ...patch },
      },
    })),

  setSelectedShapeIds: (ids) => {
    const { doc } = get();
    let newActiveStyle = get().activeStyle;
    if (ids.length === 1) {
      for (const layer of doc.layers) {
        if (layer.type === 'vector') {
          const found = layer.shapes.find((s) => s.id === ids[0]);
          if (found) {
            newActiveStyle = structuredClone(found.style);
            break;
          }
        }
      }
    }
    set((state) => ({
      doc: { ...state.doc, selectedShapeIds: ids },
      activeStyle: newActiveStyle,
    }));
  },

  selectAllInActiveLayer: () => {
    const { doc } = get();
    const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
    if (activeLayer && activeLayer.type === 'vector' && !activeLayer.locked) {
      const ids = activeLayer.shapes
        .filter((s) => s.visible && !s.locked)
        .map((s) => s.id);
      set((state) => ({
        doc: { ...state.doc, selectedShapeIds: ids },
      }));
    }
  },

  setActiveFill: (patch) => {
    const nextFill = { ...get().activeStyle.fill, ...patch };
    set((state) => ({
      activeStyle: { ...state.activeStyle, fill: nextFill },
    }));
    if (get().doc.selectedShapeIds.length > 0) {
      get().applyStyleToSelected((s) => ({
        ...s,
        fill: { ...s.fill, ...patch },
      }));
    }
  },

  setActiveStroke: (patch) => {
    const nextStroke = { ...get().activeStyle.stroke, ...patch };
    set((state) => ({
      activeStyle: { ...state.activeStyle, stroke: nextStroke },
    }));
    if (get().doc.selectedShapeIds.length > 0) {
      get().applyStyleToSelected((s) => ({
        ...s,
        stroke: { ...s.stroke, ...patch },
      }));
    }
  },

  setActiveOpacity: (opacity) => {
    set((state) => ({
      activeStyle: { ...state.activeStyle, opacity },
    }));
    if (get().doc.selectedShapeIds.length > 0) {
      get().applyStyleToSelected((s) => ({ ...s, opacity }));
    }
  },

  applyStyleToSelected: (updater) => {
    const selectedSet = new Set(get().doc.selectedShapeIds);
    if (selectedSet.size === 0) return;
    get().saveHistorySnapshot();
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((shape) =>
              selectedSet.has(shape.id)
                ? { ...shape, style: updater(structuredClone(shape.style)) }
                : shape
            ),
          };
        }),
      },
    }));
  },

  addOrUpdateGradient: (grad) =>
    set((state) => {
      const exists = state.doc.gradients.some((g) => g.id === grad.id);
      const gradients = exists
        ? state.doc.gradients.map((g) => (g.id === grad.id ? grad : g))
        : [...state.doc.gradients, grad];
      return {
        doc: { ...state.doc, gradients },
      };
    }),

  addShape: (shape, selectIt = true) => {
    get().saveHistorySnapshot();
    set((state) => {
      let targetLayerId = state.doc.activeLayerId;
      const activeLayer = state.doc.layers.find((l) => l.id === targetLayerId);

      // If active layer is a ReferenceLayer or locked, find first unlocked VectorLayer or create one
      let layers = [...state.doc.layers];
      if (!activeLayer || activeLayer.type !== 'vector' || activeLayer.locked) {
        const fallback = layers.find(
          (l) => l.type === 'vector' && !l.locked && l.visible
        );
        if (fallback) {
          targetLayerId = fallback.id;
        } else {
          const newLayerId = `layer-${Date.now()}`;
          layers.push({
            id: newLayerId,
            type: 'vector',
            name: `Vector Layer ${layers.length + 1}`,
            visible: true,
            locked: false,
            opacity: 1,
            expanded: true,
            shapes: [],
          });
          targetLayerId = newLayerId;
        }
      }

      layers = layers.map((layer) => {
        if (layer.id === targetLayerId && layer.type === 'vector') {
          return {
            ...layer,
            shapes: [...layer.shapes, shape],
          };
        }
        return layer;
      });

      return {
        doc: {
          ...state.doc,
          layers,
          activeLayerId: targetLayerId,
          selectedShapeIds: selectIt ? [shape.id] : state.doc.selectedShapeIds,
        },
      };
    });
  },

  updateShapeLive: (shapeId, updater) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) => (s.id === shapeId ? updater(s) : s)),
          };
        }),
      },
    })),

  updateShapesLive: (shapeIds, updater) => {
    const idSet = new Set(shapeIds);
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) => (idSet.has(s.id) ? updater(s) : s)),
          };
        }),
      },
    }));
  },

  deleteSelectedShapes: () => {
    const selectedSet = new Set(get().doc.selectedShapeIds);
    if (selectedSet.size === 0) return;
    get().saveHistorySnapshot();
    set((state) => ({
      doc: {
        ...state.doc,
        selectedShapeIds: [],
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.filter((s) => !selectedSet.has(s.id)),
          };
        }),
      },
      statusMessage: `Deleted ${selectedSet.size} shape(s)`,
    }));
  },

  duplicateSelectedShapes: () => {
    const selectedSet = new Set(get().doc.selectedShapeIds);
    if (selectedSet.size === 0) return;
    get().saveHistorySnapshot();
    const newIds: string[] = [];
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          const nextShapes: VectorShape[] = [];
          for (const s of layer.shapes) {
            nextShapes.push(s);
            if (selectedSet.has(s.id)) {
              const dup = translateShape(structuredClone(s), 20, 20);
              dup.id = `${s.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              dup.name = `${s.name} Copy`;
              nextShapes.push(dup);
              newIds.push(dup.id);
            }
          }
          return { ...layer, shapes: nextShapes };
        }),
        selectedShapeIds: newIds,
      },
      statusMessage: `Duplicated ${newIds.length} shape(s)`,
    }));
  },

  convertSelectedToPaths: () => {
    const selectedSet = new Set(get().doc.selectedShapeIds);
    if (selectedSet.size === 0) return;
    get().saveHistorySnapshot();
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) =>
              selectedSet.has(s.id) ? shapeToPathShape(s, true) : s
            ),
          };
        }),
      },
      statusMessage: 'Converted selected shape(s) to editable Bézier paths',
    }));
  },

  toggleShapeVisibility: (shapeId) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) =>
              s.id === shapeId ? { ...s, visible: !s.visible } : s
            ),
          };
        }),
      },
    })),

  toggleShapeLock: (shapeId) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) =>
              s.id === shapeId ? { ...s, locked: !s.locked } : s
            ),
          };
        }),
      },
    })),

  renameShape: (shapeId, name) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) =>
              s.id === shapeId ? { ...s, name } : s
            ),
          };
        }),
      },
    })),

  reorderShapeInLayer: (layerId, shapeId, direction) => {
    get().saveHistorySnapshot();
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.id !== layerId || layer.type !== 'vector') return layer;
          const idx = layer.shapes.findIndex((s) => s.id === shapeId);
          if (idx === -1) return layer;
          const shapes = [...layer.shapes];
          const [item] = shapes.splice(idx, 1);
          if (direction === 'up') {
            shapes.splice(Math.min(shapes.length, idx + 1), 0, item);
          } else if (direction === 'down') {
            shapes.splice(Math.max(0, idx - 1), 0, item);
          } else if (direction === 'top') {
            shapes.push(item);
          } else if (direction === 'bottom') {
            shapes.unshift(item);
          }
          return { ...layer, shapes };
        }),
      },
    }));
  },

  alignSelectedShapes: (mode) => {
    const { doc } = get();
    const selectedSet = new Set(doc.selectedShapeIds);
    const selectedShapes: VectorShape[] = [];
    for (const l of doc.layers) {
      if (l.type === 'vector') {
        for (const s of l.shapes) {
          if (selectedSet.has(s.id)) selectedShapes.push(s);
        }
      }
    }
    if (selectedShapes.length < 2) return;
    const multiBox = getMultiBoundingBox(selectedShapes);
    if (!multiBox) return;

    get().saveHistorySnapshot();
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((layer) => {
          if (layer.type !== 'vector') return layer;
          return {
            ...layer,
            shapes: layer.shapes.map((s) => {
              if (!selectedSet.has(s.id)) return s;
              const b = getShapeBoundingBox(s);
              let dx = 0;
              let dy = 0;
              if (mode === 'left') dx = multiBox.x - b.x;
              if (mode === 'center') dx = multiBox.cx - b.cx;
              if (mode === 'right')
                dx = multiBox.x + multiBox.width - (b.x + b.width);
              if (mode === 'top') dy = multiBox.y - b.y;
              if (mode === 'middle') dy = multiBox.cy - b.cy;
              if (mode === 'bottom')
                dy = multiBox.y + multiBox.height - (b.y + b.height);
              return translateShape(s, dx, dy);
            }),
          };
        }),
      },
    }));
  },

  booleanSelectedShapes: (op) => {
    const { doc } = get();
    const selectedSet = new Set(doc.selectedShapeIds);
    const selectedShapes: VectorShape[] = [];
    for (const l of doc.layers) {
      if (l.type === 'vector') {
        for (const s of l.shapes) {
          if (selectedSet.has(s.id)) selectedShapes.push(s);
        }
      }
    }
    if (selectedShapes.length < 2) return;
    const result = performBooleanOperation(selectedShapes, op);
    if (!result) return;

    get().saveHistorySnapshot();
    set((state) => {
      let inserted = false;
      const layers = state.doc.layers.map((layer) => {
        if (layer.type !== 'vector') return layer;
        const nextShapes: VectorShape[] = [];
        for (const s of layer.shapes) {
          if (selectedSet.has(s.id)) {
            if (!inserted) {
              nextShapes.push(result);
              inserted = true;
            }
          } else {
            nextShapes.push(s);
          }
        }
        return { ...layer, shapes: nextShapes };
      });
      return {
        doc: {
          ...state.doc,
          layers,
          selectedShapeIds: [result.id],
        },
        statusMessage: `Applied Boolean ${op} operation`,
      };
    });
  },

  replaceShapesFromShapeBuilder: (sourceShapeIds, newShapes) => {
    const sourceSet = new Set(sourceShapeIds);
    if (sourceSet.size === 0) return;
    get().saveHistorySnapshot();
    set((state) => {
      let inserted = false;
      const layers = state.doc.layers.map((layer) => {
        if (layer.type !== 'vector') return layer;
        const hasSource = layer.shapes.some((s) => sourceSet.has(s.id));
        if (!hasSource) return layer;

        const nextShapes: VectorShape[] = [];
        for (const s of layer.shapes) {
          if (sourceSet.has(s.id)) {
            if (!inserted) {
              nextShapes.push(...newShapes);
              inserted = true;
            }
          } else {
            nextShapes.push(s);
          }
        }
        return { ...layer, shapes: nextShapes };
      });

      const wasPreselected = state.doc.selectedShapeIds.length > 0;
      return {
        doc: {
          ...state.doc,
          layers,
          selectedShapeIds: wasPreselected
            ? newShapes.map((s) => s.id)
            : [],
        },
      };
    });
  },

  setActiveLayerId: (id) =>
    set((state) => ({
      doc: { ...state.doc, activeLayerId: id },
    })),

  addVectorLayer: (name) => {
    get().saveHistorySnapshot();
    const id = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    set((state) => {
      const vectorCount = state.doc.layers.filter(
        (l) => l.type === 'vector'
      ).length;
      const newLayer: VectorLayer = {
        id,
        type: 'vector',
        name: name || `Vector Layer ${vectorCount + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
        expanded: true,
        shapes: [],
      };
      return {
        doc: {
          ...state.doc,
          layers: [...state.doc.layers, newLayer],
          activeLayerId: id,
        },
        statusMessage: `Added "${newLayer.name}"`,
      };
    });
    return id;
  },

  addReferenceLayer: ({ name, dataUrl, width, height }) => {
    get().saveHistorySnapshot();
    const id = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const { doc } = get();
    // Fit nicely inside artboard while preserving aspect ratio
    const maxW = doc.width * 0.8;
    const maxH = doc.height * 0.8;
    const scale = Math.min(1, maxW / Math.max(1, width), maxH / Math.max(1, height));
    const dispW = Math.round(width * scale);
    const dispH = Math.round(height * scale);
    const x = Math.round((doc.width - dispW) / 2);
    const y = Math.round((doc.height - dispH) / 2);

    const newRef: ReferenceLayer = {
      id,
      type: 'reference',
      name: `Ref: ${name}`,
      visible: true,
      locked: true, // locked by default so user can immediately trace over it!
      opacity: 0.45,
      dataUrl,
      x,
      y,
      width: dispW,
      height: dispH,
      naturalWidth: width,
      naturalHeight: height,
      rotation: 0,
      exportWithSvg: false,
    };

    preloadReferenceLayerForSampling(newRef);

    set((state) => ({
      doc: {
        ...state.doc,
        // Insert at bottom of layer stack by default so vector layers render on top
        layers: [newRef, ...state.doc.layers],
      },
      statusMessage: `Added Reference PNG "${name}" (45% opacity, locked for tracing — unlock in Layers panel to move/resize)`,
    }));
    return id;
  },

  updateReferenceLayerLive: (layerId, patch) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((l) =>
          l.id === layerId && l.type === 'reference' ? { ...l, ...patch } : l
        ),
      },
    })),

  deleteLayer: (layerId) => {
    const { doc } = get();
    if (doc.layers.length <= 1) return;
    get().saveHistorySnapshot();
    set((state) => {
      const remaining = state.doc.layers.filter((l) => l.id !== layerId);
      const nextActive =
        state.doc.activeLayerId === layerId
          ? remaining[remaining.length - 1].id
          : state.doc.activeLayerId;
      return {
        doc: {
          ...state.doc,
          layers: remaining,
          activeLayerId: nextActive,
        },
      };
    });
  },

  toggleLayerVisibility: (layerId) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((l) =>
          l.id === layerId ? { ...l, visible: !l.visible } : l
        ),
      },
    })),

  toggleLayerLock: (layerId) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((l) =>
          l.id === layerId ? { ...l, locked: !l.locked } : l
        ),
      },
    })),

  toggleLayerExpanded: (layerId) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((l) =>
          l.id === layerId && l.type === 'vector'
            ? { ...l, expanded: !l.expanded }
            : l
        ),
      },
    })),

  setLayerOpacity: (layerId, opacity) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((l) =>
          l.id === layerId ? { ...l, opacity } : l
        ),
      },
    })),

  renameLayer: (layerId, name) =>
    set((state) => ({
      doc: {
        ...state.doc,
        layers: state.doc.layers.map((l) =>
          l.id === layerId ? { ...l, name } : l
        ),
      },
    })),

  reorderLayer: (layerId, direction) => {
    get().saveHistorySnapshot();
    set((state) => {
      const idx = state.doc.layers.findIndex((l) => l.id === layerId);
      if (idx === -1) return state;
      const layers = [...state.doc.layers];
      // Note: layers array is bottom-to-top in rendering, so 'up' in visual stack means higher index
      const targetIdx =
        direction === 'up'
          ? Math.min(layers.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      if (targetIdx === idx) return state;
      const [item] = layers.splice(idx, 1);
      layers.splice(targetIdx, 0, item);
      return {
        doc: { ...state.doc, layers },
      };
    });
  },

  importVectorLayers: (
    importedLayers,
    importedGradients,
    replaceDocument = false,
    width,
    height
  ) => {
    get().saveHistorySnapshot();
    set((state) => {
      const mergedGradients = [...state.doc.gradients];
      for (const g of importedGradients) {
        if (!mergedGradients.some((ex) => ex.id === g.id)) {
          mergedGradients.push(g);
        }
      }
      const nextLayers: LayerItem[] = replaceDocument
        ? importedLayers
        : [...state.doc.layers, ...importedLayers];
      const activeId =
        importedLayers[importedLayers.length - 1]?.id ||
        state.doc.activeLayerId;
      return {
        doc: {
          ...state.doc,
          width: replaceDocument && width ? width : state.doc.width,
          height: replaceDocument && height ? height : state.doc.height,
          layers: nextLayers,
          activeLayerId: activeId,
          gradients: mergedGradients,
          selectedShapeIds: [],
        },
        statusMessage: `Imported ${importedLayers.length} SVG layer(s)`,
      };
    });
  },
}));

