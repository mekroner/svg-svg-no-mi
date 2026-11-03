import paper from 'paper';
import {
  Point,
  SnapConfig,
  SnapResult,
  VectorShape,
} from '../types/document';
import {
  distance,
  getShapeAnchorPoints,
  getShapeBoundingBox,
  shapeToPathShape,
} from './geometry';

let snapScope: paper.PaperScope | null = null;

function getSnapPaperScope(): paper.PaperScope {
  if (!snapScope) {
    snapScope = new paper.PaperScope();
    snapScope.setup(new snapScope.Size(4000, 4000));
  } else {
    snapScope.activate();
    snapScope.project.clear();
  }
  return snapScope;
}

export function computeSmartSnap(
  rawPoint: Point,
  candidateShapes: VectorShape[],
  config: SnapConfig,
  gridSize: number,
  zoom: number,
  excludeShapeIds: string[] = [],
  extraAnchorPoints: Point[] = []
): SnapResult {
  if (!config.enabled) {
    return { point: rawPoint, snapped: false };
  }

  const worldTol = config.snapTolerance / Math.max(0.1, zoom);
  const excludeSet = new Set(excludeShapeIds);
  const activeShapes = candidateShapes.filter(
    (s) => s.visible && !excludeSet.has(s.id)
  );

  // 1. Snap to Anchor Points & Endpoints (Highest Priority)
  if (config.snapToAnchors) {
    let bestAnchor: Point | null = null;
    let bestDist = worldTol;

    for (const pt of extraAnchorPoints) {
      const d = distance(rawPoint, pt);
      if (d <= bestDist) {
        bestDist = d;
        bestAnchor = pt;
      }
    }

    for (const shape of activeShapes) {
      const anchors = getShapeAnchorPoints(shape);
      for (const a of anchors) {
        const d = distance(rawPoint, a);
        if (d <= bestDist) {
          bestDist = d;
          bestAnchor = a;
        }
      }
    }

    if (bestAnchor) {
      return {
        point: { x: bestAnchor.x, y: bestAnchor.y },
        snapped: true,
        snapType: 'anchor',
        label: 'Anchor',
      };
    }
  }

  // Build Paper.js paths for intersections & curve snapping if needed
  if (
    (config.snapToIntersections || config.snapToCurves) &&
    activeShapes.length > 0
  ) {
    const scope = getSnapPaperScope();
    const paths: paper.Path[] = [];

    for (const shape of activeShapes) {
      const ps = shapeToPathShape(shape, true);
      const p = new scope.Path({ insert: false });
      for (const seg of ps.segments) {
        p.add(
          new scope.Segment(
            new scope.Point(seg.point.x, seg.point.y),
            new scope.Point(seg.handleIn.x, seg.handleIn.y),
            new scope.Point(seg.handleOut.x, seg.handleOut.y)
          )
        );
      }
      p.closed = ps.closed;
      paths.push(p);
    }

    // 2. Snap to Path Intersections
    if (config.snapToIntersections && paths.length >= 2) {
      let bestIntersection: Point | null = null;
      let bestDist = worldTol;

      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const hits = paths[i].getIntersections(paths[j]);
          for (const h of hits) {
            const pt = { x: h.point.x, y: h.point.y };
            const d = distance(rawPoint, pt);
            if (d <= bestDist) {
              bestDist = d;
              bestIntersection = pt;
            }
          }
        }
      }

      if (bestIntersection) {
        return {
          point: bestIntersection,
          snapped: true,
          snapType: 'intersection',
          label: 'Intersection',
        };
      }
    }

    // 3. Snap to Curve Edges (On-Path projection)
    if (config.snapToCurves) {
      let bestCurvePt: Point | null = null;
      let bestDist = worldTol * 0.85;
      const testPt = new scope.Point(rawPoint.x, rawPoint.y);

      for (const p of paths) {
        const loc = p.getNearestLocation(testPt);
        if (loc) {
          const d = loc.point.getDistance(testPt);
          if (d <= bestDist) {
            bestDist = d;
            bestCurvePt = { x: loc.point.x, y: loc.point.y };
          }
        }
      }

      if (bestCurvePt) {
        return {
          point: bestCurvePt,
          snapped: true,
          snapType: 'curve',
          label: 'Path Edge',
        };
      }
    }
  }

  // 4. Snap to Object Centers & Alignment Guides
  if (config.snapToCenters && activeShapes.length > 0) {
    let bestCenter: Point | null = null;
    let bestDist = worldTol;

    for (const shape of activeShapes) {
      const bbox = getShapeBoundingBox(shape);
      const center = { x: bbox.cx, y: bbox.cy };
      const d = distance(rawPoint, center);
      if (d <= bestDist) {
        bestDist = d;
        bestCenter = center;
      }
    }

    if (bestCenter) {
      return {
        point: bestCenter,
        snapped: true,
        snapType: 'center',
        label: 'Center',
      };
    }

    // Check horizontal or vertical alignment with centers
    for (const shape of activeShapes) {
      const bbox = getShapeBoundingBox(shape);
      if (Math.abs(rawPoint.x - bbox.cx) <= worldTol * 0.6) {
        return {
          point: { x: bbox.cx, y: rawPoint.y },
          snapped: true,
          snapType: 'center',
          label: 'Align X',
          guideLine: { x1: bbox.cx, y1: bbox.cy, x2: bbox.cx, y2: rawPoint.y },
        };
      }
      if (Math.abs(rawPoint.y - bbox.cy) <= worldTol * 0.6) {
        return {
          point: { x: rawPoint.x, y: bbox.cy },
          snapped: true,
          snapType: 'center',
          label: 'Align Y',
          guideLine: { x1: bbox.cx, y1: bbox.cy, x2: rawPoint.x, y2: bbox.cy },
        };
      }
    }
  }

  // 5. Snap to Grid
  if (config.snapToGrid && gridSize > 0) {
    const gx = Math.round(rawPoint.x / gridSize) * gridSize;
    const gy = Math.round(rawPoint.y / gridSize) * gridSize;
    if (distance(rawPoint, { x: gx, y: gy }) <= worldTol) {
      return {
        point: { x: gx, y: gy },
        snapped: true,
        snapType: 'grid',
        label: 'Grid',
      };
    }
  }

  return { point: rawPoint, snapped: false };
}

