export type ToolType =
  | 'select'
  | 'node'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'spline'
  | 'pen'
  | 'shape-builder'
  | 'eyedropper'
  | 'reference-transform'
  | 'hand';

export interface Point {
  x: number;
  y: number;
}

export interface SplinePoint {
  x: number;
  y: number;
  smooth: boolean;
}

export interface BezierSegment {
  point: Point;
  handleIn: Point; // relative offset from point
  handleOut: Point; // relative offset from point
}

export interface GradientStop {
  offset: number; // 0 to 1
  color: string;
  opacity: number;
}

export interface GradientDef {
  id: string;
  name: string;
  type: 'linear' | 'radial';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
   stops: GradientStop[];
}

export interface FillStyle {
  type: 'none' | 'solid' | 'linear-gradient' | 'radial-gradient';
  color: string;
  opacity: number;
  gradientId?: string;
}

export type StrokeCap = 'butt' | 'round' | 'square';
export type StrokeJoin = 'miter' | 'round' | 'bevel';

export interface StrokeStyle {
  color: string;
  width: number;
  opacity: number;
  cap: StrokeCap;
  join: StrokeJoin;
  dashArray: number[];
}

export interface ShapeStyle {
  fill: FillStyle;
  stroke: StrokeStyle;
  opacity: number;
}

export interface ShapeTransform {
  rotation: number; // degrees around shape center
}

export interface BaseShape {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  style: ShapeStyle;
  transform: ShapeTransform;
}

export interface RectShape extends BaseShape {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}

export interface EllipseShape extends BaseShape {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface LineShape extends BaseShape {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SplineShape extends BaseShape {
  type: 'spline';
  points: SplinePoint[];
  closed: boolean;
  tension: number; // 0.0 (sharp polyline) to 1.0 (loose curve), default 0.5
}

export interface PathShape extends BaseShape {
  type: 'path';
  d: string;
  segments: BezierSegment[];
  closed: boolean;
  compoundPaths?: {
    segments: BezierSegment[];
    closed: boolean;
  }[];
}

export type VectorShape =
  | RectShape
  | EllipseShape
  | LineShape
  | SplineShape
  | PathShape;

export interface VectorLayer {
  id: string;
  type: 'vector';
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  expanded: boolean;
  shapes: VectorShape[];
}

export interface ReferenceLayer {
  id: string;
  type: 'reference';
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  rotation: number;
  exportWithSvg: boolean;
}

export type LayerItem = VectorLayer | ReferenceLayer;

export interface SnapConfig {
  enabled: boolean;
  snapToAnchors: boolean;
  snapToCurves: boolean;
  snapToIntersections: boolean;
  snapToCenters: boolean;
  snapToGrid: boolean;
  snapTolerance: number; // in screen pixels
}

export interface ShapeBuilderOptions {
  mode: 'merge' | 'erase';
  gapTolerance: number; // 0 to 15 document units
  styleMode: 'active-or-inherit' | 'always-active' | 'always-inherit';
}

export interface SplineToolOptions {
  tension: number;
  autoCloseDistance: number;
}

export interface DocumentState {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  transparentBackground: boolean;
  showGrid: boolean;
  gridSize: number;
  layers: LayerItem[];
  activeLayerId: string;
  selectedShapeIds: string[];
  gradients: GradientDef[];
  snapConfig: SnapConfig;
  shapeBuilderOptions: ShapeBuilderOptions;
  splineToolOptions: SplineToolOptions;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface SnapResult {
  point: Point;
  snapped: boolean;
  snapType?: 'anchor' | 'intersection' | 'curve' | 'center' | 'grid';
  label?: string;
  guideLine?: { x1: number; y1: number; x2: number; y2: number };
}

