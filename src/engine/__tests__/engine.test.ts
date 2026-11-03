// @vitest-environment jsdom
import './setupCanvasMock';
import { describe, expect, it } from 'vitest';
import {
  shapeToPathShape,
  splineToBezierSegments,
  segmentsToPathData,
} from '../geometry';
import {
  applyShapeBuilderStroke,
  buildPlanarArrangement,
  hitTestArrangement,
} from '../shapeBuilder';
import {
  deserializeProject,
  exportDocumentToSvg,
  parseSvgToLayers,
  serializeProject,
} from '../svgIo';
import { createStarterDocument } from '../../store/useDocumentStore';
import {
  EllipseShape,
  LineShape,
  ShapeStyle,
  SplineShape,
} from '../../types/document';

const DEFAULT_STYLE: ShapeStyle = {
  fill: { type: 'solid', color: '#6366f1', opacity: 1 },
  stroke: {
    color: '#1e293b',
    width: 2,
    opacity: 1,
    cap: 'round',
    join: 'round',
    dashArray: [],
  },
  opacity: 1,
};

describe('Geometry & Smooth Spline Engine', () => {
  it('converts pass-through spline points into smooth cubic Bézier segments', () => {
    const pts = [
      { x: 0, y: 0, smooth: true },
      { x: 100, y: 80, smooth: true },
      { x: 200, y: 0, smooth: false }, // sharp corner
      { x: 300, y: 80, smooth: true },
    ];
    const segs = splineToBezierSegments(pts, false, 0.5);
    expect(segs).toHaveLength(4);
    // Point 1 (index 1) is smooth -> non-zero handles
    expect(Math.hypot(segs[1].handleIn.x, segs[1].handleIn.y)).toBeGreaterThan(5);
    expect(Math.hypot(segs[1].handleOut.x, segs[1].handleOut.y)).toBeGreaterThan(5);
    // Point 2 (index 2) is sharp -> zero handles
    expect(segs[2].handleIn).toEqual({ x: 0, y: 0 });
    expect(segs[2].handleOut).toEqual({ x: 0, y: 0 });

    const d = segmentsToPathData(segs, false);
    expect(d).toContain('M 0 0');
    expect(d).toContain('C ');
  });

  it('converts parametric shapes (rect, ellipse, spline) into PathShape', () => {
    const spline: SplineShape = {
      id: 's1',
      type: 'spline',
      name: 'Wave',
      visible: true,
      locked: false,
      closed: true,
      tension: 0.5,
      points: [
        { x: 0, y: 0, smooth: true },
        { x: 100, y: 0, smooth: true },
        { x: 50, y: 80, smooth: true },
      ],
      style: DEFAULT_STYLE,
      transform: { rotation: 0 },
    };
    const pathShape = shapeToPathShape(spline, true);
    expect(pathShape.type).toBe('path');
    expect(pathShape.closed).toBe(true);
    expect(pathShape.d).toContain('Z');
  });
});

describe('Planar-Graph Illustrator-Style Shape Builder', () => {
  it('decomposes two overlapping circles into 3 minimal enclosed faces and merges them', () => {
    const c1: EllipseShape = {
      id: 'c1',
      type: 'ellipse',
      name: 'Circle 1',
      visible: true,
      locked: false,
      cx: 100,
      cy: 100,
      rx: 60,
      ry: 60,
      style: DEFAULT_STYLE,
      transform: { rotation: 0 },
    };
    const c2: EllipseShape = {
      id: 'c2',
      type: 'ellipse',
      name: 'Circle 2',
      visible: true,
      locked: false,
      cx: 160,
      cy: 100,
      rx: 60,
      ry: 60,
      style: {
        ...DEFAULT_STYLE,
        fill: { type: 'solid', color: '#06b6d4', opacity: 1 },
      },
      transform: { rotation: 0 },
    };

    const arrangement = buildPlanarArrangement([c1, c2], 2);
    expect(arrangement.faces.length).toBe(3);
    expect(arrangement.danglingEdges.length).toBe(0);

    // Hit test the lens intersection at (130, 100)
    const hitCenter = hitTestArrangement(arrangement, { x: 130, y: 100 });
    expect(hitCenter.faceId).not.toBeNull();

    // Merge all 3 regions into 1 unified shape
    const mergedShapes = applyShapeBuilderStroke({
      inputShapes: [c1, c2],
      arrangement,
      touchedFaceIds: arrangement.faces.map((f) => f.id),
      touchedEdgeIds: [],
      mode: 'merge',
      styleMode: 'active-or-inherit',
      activeStyle: DEFAULT_STYLE,
    });

    expect(mergedShapes).toHaveLength(1);
    expect(mergedShapes[0].type).toBe('path');
  });

  it('detects enclosed face and overhanging dangling tails from 3 intersecting open lines, and trims tails in erase mode', () => {
    // 3 intersecting open lines forming a central triangle with 6 overhanging tails
    const l1: LineShape = {
      id: 'l1',
      type: 'line',
      name: 'Horizontal Line',
      visible: true,
      locked: false,
      x1: 50,
      y1: 200,
      x2: 350,
      y2: 200,
      style: { ...DEFAULT_STYLE, fill: { type: 'none', color: '#000', opacity: 0 } },
      transform: { rotation: 0 },
    };
    const l2: LineShape = {
      id: 'l2',
      type: 'line',
      name: 'Left Diagonal',
      visible: true,
      locked: false,
      x1: 80,
      y1: 250,
      x2: 230,
      y2: 50,
      style: { ...DEFAULT_STYLE, fill: { type: 'none', color: '#000', opacity: 0 } },
      transform: { rotation: 0 },
    };
    const l3: LineShape = {
      id: 'l3',
      type: 'line',
      name: 'Right Diagonal',
      visible: true,
      locked: false,
      x1: 170,
      y1: 50,
      x2: 320,
      y2: 250,
      style: { ...DEFAULT_STYLE, fill: { type: 'none', color: '#000', opacity: 0 } },
      transform: { rotation: 0 },
    };

    const arrangement = buildPlanarArrangement([l1, l2, l3], 2);
    expect(arrangement.faces.length).toBe(1);
    expect(arrangement.danglingEdges.length).toBe(6);

    // Erase/trim 2 of the overhanging tails
    const afterTrim = applyShapeBuilderStroke({
      inputShapes: [l1, l2, l3],
      arrangement,
      touchedFaceIds: [],
      touchedEdgeIds: [
        arrangement.danglingEdges[0].id,
        arrangement.danglingEdges[1].id,
      ],
      mode: 'erase',
      styleMode: 'active-or-inherit',
      activeStyle: DEFAULT_STYLE,
    });

    // 1 face frame + 4 remaining dangling edges = 5 shapes
    expect(afterTrim.length).toBe(5);
  });

  it('closes small gaps between open line endpoints when gapTolerance is enabled', () => {
    const a: LineShape = {
      id: 'a',
      type: 'line',
      name: 'A',
      visible: true,
      locked: false,
      x1: 100,
      y1: 100,
      x2: 200,
      y2: 100,
      style: DEFAULT_STYLE,
      transform: { rotation: 0 },
    };
    const b: LineShape = {
      id: 'b',
      type: 'line',
      name: 'B',
      visible: true,
      locked: false,
      x1: 200,
      y1: 100,
      x2: 150,
      y2: 180,
      style: DEFAULT_STYLE,
      transform: { rotation: 0 },
    };
    // Line C stops 3px short of (100, 100) at (100, 103)
    const c: LineShape = {
      id: 'c',
      type: 'line',
      name: 'C',
      visible: true,
      locked: false,
      x1: 150,
      y1: 180,
      x2: 100,
      y2: 103,
      style: DEFAULT_STYLE,
      transform: { rotation: 0 },
    };

    const withoutGapTol = buildPlanarArrangement([a, b, c], 0);
    expect(withoutGapTol.faces.length).toBe(0);

    const withGapTol = buildPlanarArrangement([a, b, c], 5);
    expect(withGapTol.faces.length).toBe(1);
  });

  it('splits overlapping circles bisected by an open smooth spline into 6 sub-regions plus 2 overhanging spline tails', () => {
    const doc = createStarterDocument(true);
    const firstLayer = doc.layers[0];
    expect(firstLayer.type).toBe('vector');
    if (firstLayer.type === 'vector') {
      const arrangement = buildPlanarArrangement(firstLayer.shapes, 4);
      // 2 overlapping circles (3 regions) bisected horizontally by a spline -> 6 enclosed faces + 2 overhanging spline ends!
      expect(arrangement.faces.length).toBe(6);
      expect(arrangement.danglingEdges.length).toBe(2);
    }
  });
});

describe('SVG Import, Clean Export & Project Serialization', () => {
  it('excludes Reference PNG layers from clean SVG export by default and preserves vector layers', () => {
    const doc = createStarterDocument(true);
    doc.layers.unshift({
      id: 'ref-1',
      type: 'reference',
      name: 'Sketch Reference',
      visible: true,
      locked: true,
      opacity: 0.5,
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      naturalWidth: 500,
      naturalHeight: 500,
      rotation: 0,
      exportWithSvg: false,
    });

    const cleanSvg = exportDocumentToSvg(doc);
    expect(cleanSvg).toContain('<svg');
    expect(cleanSvg).toContain('data-layer-name="Vector Layer 1"');
    expect(cleanSvg).not.toContain('data-reference="true"');

    // Round-trip import of exported SVG
    const parsed = parseSvgToLayers(cleanSvg);
    expect(parsed.layers.length).toBe(1);
    expect(parsed.layers[0].shapes.length).toBe(3);

    // Project .ssnm round-trip preserves reference layer
    const ssnm = serializeProject(doc);
    const restored = deserializeProject(ssnm);
    expect(restored.layers.some((l) => l.type === 'reference')).toBe(true);
  });
});
