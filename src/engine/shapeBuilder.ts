import paper from 'paper';
import {
  BezierSegment,
  PathShape,
  Point,
  ShapeBuilderOptions,
  ShapeStyle,
  VectorShape,
} from '../types/document';
import {
  distance,
  segmentsToPathData,
  shapeToPathShape,
} from './geometry';

export interface PlanarFace {
  id: string;
  d: string;
  segments: BezierSegment[];
  compoundPaths?: { segments: BezierSegment[]; closed: boolean }[];
  area: number;
  interiorPoint: Point;
  sourceShapeIds: string[];
  inheritedStyle: ShapeStyle | null;
  wasOriginallyFilled: boolean;
}

export interface PlanarDanglingEdge {
  id: string;
  d: string;
  segments: BezierSegment[];
  sourceShapeId: string;
  style: ShapeStyle;
  midpoint: Point;
}

export interface PlanarArrangement {
  faces: PlanarFace[];
  danglingEdges: PlanarDanglingEdge[];
}

let sharedScope: paper.PaperScope | null = null;

function getPaperScope(): paper.PaperScope {
  if (!sharedScope) {
    sharedScope = new paper.PaperScope();
    sharedScope.setup(new sharedScope.Size(4000, 4000));
  } else {
    sharedScope.activate();
    sharedScope.project.clear();
  }
  return sharedScope;
}

function segmentsToPaperPath(
  scope: paper.PaperScope,
  segments: BezierSegment[],
  closed: boolean
): paper.Path {
  const path = new scope.Path({ insert: false });
  for (const seg of segments) {
    path.add(
      new scope.Segment(
        new scope.Point(seg.point.x, seg.point.y),
        new scope.Point(seg.handleIn.x, seg.handleIn.y),
        new scope.Point(seg.handleOut.x, seg.handleOut.y)
      )
    );
  }
  path.closed = closed;
  return path;
}

function paperPathToSegments(path: paper.Path): BezierSegment[] {
  return path.segments.map((seg) => ({
    point: { x: seg.point.x, y: seg.point.y },
    handleIn: { x: seg.handleIn.x, y: seg.handleIn.y },
    handleOut: { x: seg.handleOut.x, y: seg.handleOut.y },
  }));
}

function paperItemToFaceGeometry(item: paper.PathItem): {
  segments: BezierSegment[];
  compoundPaths?: { segments: BezierSegment[]; closed: boolean }[];
  d: string;
} | null {
  if (item instanceof paper.Path) {
    if (item.segments.length < 2) return null;
    const segments = paperPathToSegments(item);
    const d = segmentsToPathData(segments, item.closed);
    return { segments, d };
  }
  if (item instanceof paper.CompoundPath) {
    const children = (item.children as paper.Path[]).filter(
      (c) => c.segments && c.segments.length >= 2
    );
    if (children.length === 0) return null;
    // Sort by absolute area descending so exterior boundary is first
    const sorted = [...children].sort(
      (a, b) => Math.abs(b.area) - Math.abs(a.area)
    );
    const main = sorted[0];
    const mainSegs = paperPathToSegments(main);
    const holes = sorted.slice(1).map((h) => ({
      segments: paperPathToSegments(h),
      closed: true,
    }));
    const d = segmentsToPathData(
      mainSegs,
      true,
      holes.length > 0 ? holes : undefined
    );
    return {
      segments: mainSegs,
      compoundPaths: holes.length > 0 ? holes : undefined,
      d,
    };
  }
  return null;
}

interface SourceCurveEntry {
  path: paper.Path;
  sourceShapeId: string;
  wasClosed: boolean;
  style: ShapeStyle;
}

/**
 * Extends or snaps open path endpoints within gapTolerance so nearly-touching
 * lines/splines form closed intersections.
 */
function applyGapToleranceToOpenPaths(
  scope: paper.PaperScope,
  entries: SourceCurveEntry[],
  gapTolerance: number
): void {
  if (gapTolerance <= 0.05) return;

  // 1. Snap nearby open endpoints to each other
  const endpoints: {
    entryIdx: number;
    isStart: boolean;
    point: paper.Point;
  }[] = [];

  entries.forEach((entry, idx) => {
    if (!entry.wasClosed && entry.path.segments.length >= 2) {
      endpoints.push({
        entryIdx: idx,
        isStart: true,
        point: entry.path.firstSegment.point,
      });
      endpoints.push({
        entryIdx: idx,
        isStart: false,
        point: entry.path.lastSegment.point,
      });
    }
  });

  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      const a = endpoints[i];
      const b = endpoints[j];
      if (a.entryIdx === b.entryIdx && entries[a.entryIdx].path.segments.length <= 2) {
        continue;
      }
      const dist = a.point.getDistance(b.point);
      if (dist > 1e-4 && dist <= gapTolerance) {
        const mid = a.point.add(b.point).divide(2);
        const segA = a.isStart
          ? entries[a.entryIdx].path.firstSegment
          : entries[a.entryIdx].path.lastSegment;
        const segB = b.isStart
          ? entries[b.entryIdx].path.firstSegment
          : entries[b.entryIdx].path.lastSegment;
        segA.point = mid;
        segB.point = mid;
        a.point = mid;
        b.point = mid;
      }
    }
  }

  // 2. Extend or snap open endpoints onto nearby curves
  for (const ep of endpoints) {
    const entry = entries[ep.entryIdx];
    const p = entry.path;
    const pt = ep.isStart ? p.firstSegment.point : p.lastSegment.point;

    // Check if already touching another path
    let alreadyTouching = false;
    for (let j = 0; j < entries.length; j++) {
      if (j === ep.entryIdx) continue;
      const loc = entries[j].path.getNearestLocation(pt);
      if (loc && loc.point.getDistance(pt) <= 0.35) {
        alreadyTouching = true;
        break;
      }
    }
    if (alreadyTouching) continue;

    // Try tangent ray extension first
    const offset = ep.isStart ? 0 : p.length;
    const rawTan = p.getTangentAt(offset);
    if (rawTan) {
      const outDir = ep.isStart ? rawTan.multiply(-1) : rawTan;
      const rayEnd = pt.add(outDir.multiply(gapTolerance * 1.15));
      const ray = new scope.Path.Line({
        from: pt,
        to: rayEnd,
        insert: false,
      });

      let bestHit: paper.Point | null = null;
      let bestDist = Infinity;

      for (let j = 0; j < entries.length; j++) {
        if (j === ep.entryIdx) continue;
        const hits = ray.getIntersections(entries[j].path);
        for (const h of hits) {
          const d = h.point.getDistance(pt);
          if (d <= gapTolerance && d < bestDist) {
            bestDist = d;
            bestHit = h.point;
          }
        }
      }

      if (bestHit) {
        // Extend slightly past the hit so intersection detection is robust
        const extended = bestHit.add(outDir.multiply(0.1));
        if (ep.isStart) {
          p.firstSegment.point = extended;
        } else {
          p.lastSegment.point = extended;
        }
        continue;
      }
    }

    // Fallback: snap to nearest point on any other curve within gapTolerance
    let nearestPt: paper.Point | null = null;
    let nearestDist = gapTolerance;
    for (let j = 0; j < entries.length; j++) {
      if (j === ep.entryIdx) continue;
      const loc = entries[j].path.getNearestLocation(pt);
      if (loc) {
        const d = loc.point.getDistance(pt);
        if (d <= nearestDist) {
          nearestDist = d;
          nearestPt = loc.point;
        }
      }
    }
    if (nearestPt) {
      if (ep.isStart) {
        p.firstSegment.point = nearestPt;
      } else {
        p.lastSegment.point = nearestPt;
      }
    }
  }
}

interface AtomicEdge {
  id: number;
  u: number;
  v: number;
  path: paper.Path;
  sourceShapeIds: Set<string>;
  style: ShapeStyle;
  wasFromClosed: boolean;
}

interface HalfEdge {
  id: number;
  edgeId: number;
  from: number;
  to: number;
  forward: boolean;
  angleAtFrom: number;
  twinId: number;
}

/**
 * Finds an interior sample point cleanly inside a closed Paper.js PathItem.
 */
function findInteriorPoint(item: paper.PathItem): Point {
  const bounds = item.bounds;
  const center = bounds.center;
  if (item.contains(center)) {
    return { x: center.x, y: center.y };
  }
  // Scan horizontal lines across bounding box to find a point strictly inside
  for (const fy of [0.5, 0.35, 0.65, 0.25, 0.75, 0.45, 0.55]) {
    const y = bounds.top + bounds.height * fy;
    for (let s = 1; s < 20; s++) {
      const x = bounds.left + (bounds.width * s) / 20;
      const testPt = new paper.Point(x, y);
      if (item.contains(testPt)) {
        return { x: testPt.x, y: testPt.y };
      }
    }
  }
  if (item instanceof paper.Path && item.segments.length > 0) {
    return { x: item.segments[0].point.x, y: item.segments[0].point.y };
  }
  return { x: center.x, y: center.y };
}

/**
 * Builds the full planar arrangement (enclosed minimal faces + dangling open edges)
 * from any mix of closed shapes and open lines/splines/paths.
 */
export function buildPlanarArrangement(
  shapes: VectorShape[],
  gapTolerance = 3
): PlanarArrangement {
  const scope = getPaperScope();
  const visibleShapes = shapes.filter((s) => s.visible && !s.locked);
  if (visibleShapes.length === 0) {
    return { faces: [], danglingEdges: [] };
  }

  const entries: SourceCurveEntry[] = [];
  const closedShapePaperItems: {
    shape: VectorShape;
    item: paper.PathItem;
  }[] = [];

  for (const shape of visibleShapes) {
    const pathShape = shapeToPathShape(shape, true);
    const mainPath = segmentsToPaperPath(
      scope,
      pathShape.segments,
      pathShape.closed
    );
    if (mainPath.length > 0.1) {
      entries.push({
        path: mainPath,
        sourceShapeId: shape.id,
        wasClosed: pathShape.closed,
        style: structuredClone(shape.style),
      });
    }
    if (pathShape.compoundPaths) {
      for (const cp of pathShape.compoundPaths) {
        const sub = segmentsToPaperPath(scope, cp.segments, cp.closed);
        if (sub.length > 0.1) {
          entries.push({
            path: sub,
            sourceShapeId: shape.id,
            wasClosed: cp.closed,
            style: structuredClone(shape.style),
          });
        }
      }
    }

    if (pathShape.closed) {
      if (pathShape.compoundPaths && pathShape.compoundPaths.length > 0) {
        const comp = new scope.CompoundPath({ insert: false });
        comp.addChild(mainPath.clone({ insert: false }));
        for (const cp of pathShape.compoundPaths) {
          comp.addChild(segmentsToPaperPath(scope, cp.segments, cp.closed));
        }
        closedShapePaperItems.push({ shape, item: comp });
      } else {
        closedShapePaperItems.push({
          shape,
          item: mainPath.clone({ insert: false }),
        });
      }
    }
  }

  if (entries.length === 0) {
    return { faces: [], danglingEdges: [] };
  }

  // Step 1: Apply gap tolerance so near-touching open endpoints snap/intersect
  applyGapToleranceToOpenPaths(scope, entries, gapTolerance);

  // Step 2: Collect all vertices (endpoints + pairwise & self intersections)
  const VERTEX_EPS = 0.6;
  const vertices: Point[] = [];

  const getOrAddVertex = (pt: { x: number; y: number }): number => {
    for (let i = 0; i < vertices.length; i++) {
      if (distance(vertices[i], pt) <= VERTEX_EPS) {
        return i;
      }
    }
    vertices.push({ x: pt.x, y: pt.y });
    return vertices.length - 1;
  };

  for (const e of entries) {
    const p = e.path;
    if (p.segments.length === 0) continue;
    getOrAddVertex(p.firstSegment.point);
    if (!p.closed) {
      getOrAddVertex(p.lastSegment.point);
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const pA = entries[i].path;
    // Self intersections
    const selfHits = pA.getIntersections(pA);
    for (const h of selfHits) {
      getOrAddVertex(h.point);
    }
    for (let j = i + 1; j < entries.length; j++) {
      const pB = entries[j].path;
      const hits = pA.getIntersections(pB);
      for (const h of hits) {
        getOrAddVertex(h.point);
      }
    }
  }

  // Also check if any existing vertex lies on the interior of any path
  // (e.g. T-junction where an endpoint snapped onto another curve)
  // Step 3: Split each path at all vertices that lie on it
  const rawAtomicEdges: AtomicEdge[] = [];
  let nextEdgeId = 0;

  for (const entry of entries) {
    const p = entry.path;
    const totalLen = p.length;
    if (totalLen < 0.25) continue;

    const splitOffsets: number[] = [];
    for (const v of vertices) {
      const vPt = new scope.Point(v.x, v.y);
      const loc = p.getNearestLocation(vPt);
      if (loc && loc.point.getDistance(vPt) <= VERTEX_EPS * 1.4) {
        splitOffsets.push(loc.offset);
      }
      // Also check all curves of p in case p passes near v multiple times
      for (const curve of p.curves) {
        const cLoc = curve.getNearestLocation(vPt);
        if (cLoc && cLoc.point.getDistance(vPt) <= VERTEX_EPS * 1.4) {
          splitOffsets.push(cLoc.offset);
        }
      }
    }

    if (p.closed) {
      splitOffsets.push(0);
    } else {
      splitOffsets.push(0);
      splitOffsets.push(totalLen);
    }

    splitOffsets.sort((a, b) => a - b);

    // Filter distinct offsets
    const uniqueOffsets: number[] = [];
    const OFFSET_EPS = 0.4;
    for (const off of splitOffsets) {
      const clamped = Math.max(0, Math.min(totalLen, off));
      if (p.closed && Math.abs(totalLen - clamped) <= OFFSET_EPS) {
        continue; // wraps to 0
      }
      if (
        uniqueOffsets.length === 0 ||
        Math.abs(clamped - uniqueOffsets[uniqueOffsets.length - 1]) > OFFSET_EPS
      ) {
        uniqueOffsets.push(clamped);
      }
    }

    // For a closed path with < 2 split points, insert a synthetic midpoint vertex
    // so every edge in the planar graph connects two distinct vertices u != v!
    if (p.closed && uniqueOffsets.length < 2) {
      const midOff = totalLen / 2;
      const midPt = p.getPointAt(midOff);
      if (midPt) {
        getOrAddVertex(midPt);
        uniqueOffsets.push(midOff);
        uniqueOffsets.sort((a, b) => a - b);
      }
    }

    if (!p.closed && uniqueOffsets.length < 2) {
      if (uniqueOffsets[0] !== 0) uniqueOffsets.unshift(0);
      if (uniqueOffsets[uniqueOffsets.length - 1] !== totalLen) {
        uniqueOffsets.push(totalLen);
      }
    }

    // Extract sub-curves between consecutive offsets
    const extractSubCurve = (offStart: number, offEnd: number): paper.Path | null => {
      const work = p.clone({ insert: false }) as paper.Path;
      if (work.closed) {
        // Open the closed path at 0 first
        const splitAtZero = work.splitAt(0);
        const openWork = splitAtZero || work;
        openWork.closed = false;
        if (offStart > 1e-3) {
          const tail = openWork.splitAt(offStart);
          if (!tail) return null;
          if (offEnd - offStart < tail.length - 1e-3) {
            tail.splitAt(offEnd - offStart);
          }
          return tail;
        } else {
          if (offEnd < openWork.length - 1e-3) {
            openWork.splitAt(offEnd);
          }
          return openWork;
        }
      } else {
        if (offStart > 1e-3) {
          const tail = work.splitAt(offStart);
          if (!tail) return null;
          if (offEnd - offStart < tail.length - 1e-3) {
            tail.splitAt(offEnd - offStart);
          }
          return tail;
        } else {
          if (offEnd < work.length - 1e-3) {
            work.splitAt(offEnd);
          }
          return work;
        }
      }
    };

    const numSegs = p.closed ? uniqueOffsets.length : uniqueOffsets.length - 1;
    for (let s = 0; s < numSegs; s++) {
      const o1 = uniqueOffsets[s];
      const o2 =
        p.closed && s === uniqueOffsets.length - 1
          ? totalLen
          : uniqueOffsets[s + 1];
      if (o2 - o1 <= 0.25) continue;

      const subPath = extractSubCurve(o1, o2);
      if (!subPath || subPath.length <= 0.25 || subPath.segments.length < 2) {
        continue;
      }
      subPath.closed = false;

      const u = getOrAddVertex(subPath.firstSegment.point);
      const v = getOrAddVertex(subPath.lastSegment.point);
      if (u === v && subPath.length < VERTEX_EPS * 2.5) {
        continue;
      }

      // If u === v on a large loop (only 1 vertex was hit), split subPath in half
      if (u === v) {
        const halfLen = subPath.length / 2;
        const midPt = subPath.getPointAt(halfLen);
        if (midPt) {
          const w = getOrAddVertex(midPt);
          const secondHalf = subPath.splitAt(halfLen);
          if (secondHalf && w !== u) {
            subPath.firstSegment.point = new scope.Point(vertices[u].x, vertices[u].y);
            subPath.lastSegment.point = new scope.Point(vertices[w].x, vertices[w].y);
            rawAtomicEdges.push({
              id: nextEdgeId++,
              u,
              v: w,
              path: subPath,
              sourceShapeIds: new Set([entry.sourceShapeId]),
              style: entry.style,
              wasFromClosed: entry.wasClosed,
            });
            secondHalf.firstSegment.point = new scope.Point(vertices[w].x, vertices[w].y);
            secondHalf.lastSegment.point = new scope.Point(vertices[v].x, vertices[v].y);
            rawAtomicEdges.push({
              id: nextEdgeId++,
              u: w,
              v,
              path: secondHalf,
              sourceShapeIds: new Set([entry.sourceShapeId]),
              style: entry.style,
              wasFromClosed: entry.wasClosed,
            });
          }
        }
        continue;
      }

      subPath.firstSegment.point = new scope.Point(vertices[u].x, vertices[u].y);
      subPath.lastSegment.point = new scope.Point(vertices[v].x, vertices[v].y);

      rawAtomicEdges.push({
        id: nextEdgeId++,
        u,
        v,
        path: subPath,
        sourceShapeIds: new Set([entry.sourceShapeId]),
        style: entry.style,
        wasFromClosed: entry.wasClosed,
      });
    }
  }

  // Step 4: Deduplicate coincident atomic edges
  const uniqueEdges: AtomicEdge[] = [];
  for (const cand of rawAtomicEdges) {
    const midCand = cand.path.getPointAt(cand.path.length * 0.5);
    const q1Cand = cand.path.getPointAt(cand.path.length * 0.25);
    const q3Cand = cand.path.getPointAt(cand.path.length * 0.75);
    let merged = false;

    for (const ex of uniqueEdges) {
      const sameDir = ex.u === cand.u && ex.v === cand.v;
      const revDir = ex.u === cand.v && ex.v === cand.u;
      if (!sameDir && !revDir) continue;

      const midEx = ex.path.getPointAt(ex.path.length * 0.5);
      if (!midCand || !midEx || midCand.getDistance(midEx) > 1.0) continue;

      const q1Ex = ex.path.getPointAt(
        ex.path.length * (sameDir ? 0.25 : 0.75)
      );
      const q3Ex = ex.path.getPointAt(
        ex.path.length * (sameDir ? 0.75 : 0.25)
      );
      if (
        q1Cand &&
        q1Ex &&
        q3Cand &&
        q3Ex &&
        q1Cand.getDistance(q1Ex) <= 1.2 &&
        q3Cand.getDistance(q3Ex) <= 1.2
      ) {
        cand.sourceShapeIds.forEach((id) => ex.sourceShapeIds.add(id));
        ex.wasFromClosed = ex.wasFromClosed || cand.wasFromClosed;
        merged = true;
        break;
      }
    }

    if (!merged) {
      uniqueEdges.push(cand);
    }
  }

  // Step 5: Iterative degree-1 pruning to find dangling open tails
  const activeEdgeIds = new Set<number>(uniqueEdges.map((e) => e.id));
  const edgeById = new Map<number, AtomicEdge>(
    uniqueEdges.map((e) => [e.id, e])
  );

  let prunedSomething = true;
  while (prunedSomething) {
    prunedSomething = false;
    const deg = new Map<number, number[]>();
    for (const eid of activeEdgeIds) {
      const e = edgeById.get(eid)!;
      if (!deg.has(e.u)) deg.set(e.u, []);
      if (!deg.has(e.v)) deg.set(e.v, []);
      deg.get(e.u)!.push(eid);
      deg.get(e.v)!.push(eid);
    }
    for (const [, inc] of deg.entries()) {
      if (inc.length === 1) {
        activeEdgeIds.delete(inc[0]);
        prunedSomething = true;
      }
    }
  }

  // Also detect and prune bridge edges (edges whose removal disconnects a component or where both sides are exterior)
  // We can detect bridges by checking if there is an alternate path between e.u and e.v without using e
  const isBridgeEdge = (testEdgeId: number): boolean => {
    const target = edgeById.get(testEdgeId)!;
    const visited = new Set<number>([target.u]);
    const queue = [target.u];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === target.v) return false;
      for (const eid of activeEdgeIds) {
        if (eid === testEdgeId) continue;
        const e = edgeById.get(eid)!;
        const next = e.u === curr ? e.v : e.v === curr ? e.u : -1;
        if (next !== -1 && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return true;
  };

  for (const eid of Array.from(activeEdgeIds)) {
    if (isBridgeEdge(eid)) {
      activeEdgeIds.delete(eid);
    }
  }

  // Re-prune any degree-1 vertices created by removing bridges
  prunedSomething = true;
  while (prunedSomething) {
    prunedSomething = false;
    const deg = new Map<number, number[]>();
    for (const eid of activeEdgeIds) {
      const e = edgeById.get(eid)!;
      if (!deg.has(e.u)) deg.set(e.u, []);
      if (!deg.has(e.v)) deg.set(e.v, []);
      deg.get(e.u)!.push(eid);
      deg.get(e.v)!.push(eid);
    }
    for (const [, inc] of deg.entries()) {
      if (inc.length === 1) {
        activeEdgeIds.delete(inc[0]);
        prunedSomething = true;
      }
    }
  }

  // Collect all pruned edges as PlanarDanglingEdges
  const danglingEdges: PlanarDanglingEdge[] = [];
  for (const e of uniqueEdges) {
    if (!activeEdgeIds.has(e.id)) {
      const segs = paperPathToSegments(e.path);
      const mid = e.path.getPointAt(e.path.length / 2) || e.path.firstSegment.point;
      danglingEdges.push({
        id: `edge-${e.id}`,
        d: segmentsToPathData(segs, false),
        segments: segs,
        sourceShapeId: Array.from(e.sourceShapeIds)[0] || '',
        style: structuredClone(e.style),
        midpoint: { x: mid.x, y: mid.y },
      });
    }
  }

  // Step 6: Build Half-Edge structure on active cycle edges
  const halfEdges: HalfEdge[] = [];
  const outgoingByVertex = new Map<number, HalfEdge[]>();

  const computeDepartureAngle = (
    path: paper.Path,
    forward: boolean,
    fromPt: Point
  ): number => {
    const sampleDist = Math.min(2.5, path.length * 0.2);
    const offset = forward ? sampleDist : path.length - sampleDist;
    const pt = path.getPointAt(offset);
    if (pt) {
      return Math.atan2(pt.y - fromPt.y, pt.x - fromPt.x);
    }
    return 0;
  };

  for (const eid of activeEdgeIds) {
    const e = edgeById.get(eid)!;
    const fwdId = halfEdges.length;
    const revId = halfEdges.length + 1;

    const fwd: HalfEdge = {
      id: fwdId,
      edgeId: eid,
      from: e.u,
      to: e.v,
      forward: true,
      angleAtFrom: computeDepartureAngle(e.path, true, vertices[e.u]),
      twinId: revId,
    };
    const rev: HalfEdge = {
      id: revId,
      edgeId: eid,
      from: e.v,
      to: e.u,
      forward: false,
      angleAtFrom: computeDepartureAngle(e.path, false, vertices[e.v]),
      twinId: fwdId,
    };

    halfEdges.push(fwd, rev);
    if (!outgoingByVertex.has(e.u)) outgoingByVertex.set(e.u, []);
    if (!outgoingByVertex.has(e.v)) outgoingByVertex.set(e.v, []);
    outgoingByVertex.get(e.u)!.push(fwd);
    outgoingByVertex.get(e.v)!.push(rev);
  }

  // Sort outgoing half-edges at each vertex by angle ascending
  for (const [, list] of outgoingByVertex.entries()) {
    list.sort((a, b) => a.angleAtFrom - b.angleAtFrom);
  }

  // Trace minimal cycles
  const visitedHalfEdge = new Set<number>();
  interface RawCycle {
    halfEdgeIds: number[];
    edgeIds: number[];
    vertices: number[];
    path: paper.Path;
    signedArea: number;
    absArea: number;
    sourceShapeIds: Set<string>;
  }
  const rawCycles: RawCycle[] = [];

  for (const startHe of halfEdges) {
    if (visitedHalfEdge.has(startHe.id)) continue;

    const cycleHeIds: number[] = [];
    const cycleEdgeIds: number[] = [];
    const cycleVerts: number[] = [];
    const sourceShapeIds = new Set<string>();

    let curr: HalfEdge | undefined = startHe;
    let safety = 0;

    while (curr && !visitedHalfEdge.has(curr.id) && safety < halfEdges.length + 5) {
      safety++;
      visitedHalfEdge.add(curr.id);
      cycleHeIds.push(curr.id);
      cycleEdgeIds.push(curr.edgeId);
      cycleVerts.push(curr.from);

      const edge = edgeById.get(curr.edgeId)!;
      edge.sourceShapeIds.forEach((sid) => sourceShapeIds.add(sid));

      // Arrive at curr.to; find twin outgoing from curr.to
      const twin = halfEdges[curr.twinId];
      const outList: HalfEdge[] = outgoingByVertex.get(curr.to) || [];
      const twinIdx = outList.findIndex((h: HalfEdge) => h.id === twin.id);
      if (twinIdx === -1) break;

      // Next half-edge turning consistently around the face interior
      const nextIdx = (twinIdx - 1 + outList.length) % outList.length;
      const nextHe: HalfEdge | undefined = outList[nextIdx];
      curr = nextHe;
      if (!curr || curr.id === startHe.id) break;
    }

    if (cycleHeIds.length >= 2) {
      // Assemble closed paper.Path from the half-edges
      const facePath = new scope.Path({ insert: false });
      for (let i = 0; i < cycleHeIds.length; i++) {
        const he = halfEdges[cycleHeIds[i]];
        const edge = edgeById.get(he.edgeId)!;
        const segClone = edge.path.clone({ insert: false }) as paper.Path;
        if (!he.forward) {
          segClone.reverse();
        }
        if (i === 0) {
          for (const seg of segClone.segments) {
            facePath.add(seg.clone());
          }
        } else {
          // Stitch handleOut onto last segment and append remaining segments
          const lastSeg = facePath.lastSegment;
          const firstNew = segClone.firstSegment;
          lastSeg.handleOut = firstNew.handleOut.clone();
          for (let k = 1; k < segClone.segments.length; k++) {
            facePath.add(segClone.segments[k].clone());
          }
        }
      }
      // Close loop handleIn on first segment
      if (facePath.segments.length >= 2) {
        const firstSeg = facePath.firstSegment;
        const lastSeg = facePath.lastSegment;
        if (firstSeg.point.getDistance(lastSeg.point) <= VERTEX_EPS * 2) {
          firstSeg.handleIn = lastSeg.handleIn.clone();
          facePath.removeSegment(facePath.segments.length - 1);
        }
      }
      facePath.closed = true;

      const signedArea = facePath.area;
      const absArea = Math.abs(signedArea);
      if (absArea > 1.0) {
        rawCycles.push({
          halfEdgeIds: cycleHeIds,
          edgeIds: cycleEdgeIds,
          vertices: cycleVerts,
          path: facePath,
          signedArea,
          absArea,
          sourceShapeIds,
        });
      }
    }
  }

  // Group cycles by connected component of vertices/edges
  // In each connected component, the single cycle with the largest absArea is the unbounded outer boundary,
  // and all cycles with the opposite sign of signedArea are the minimal interior faces!
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const eid of activeEdgeIds) {
    const e = edgeById.get(eid)!;
    union(e.u, e.v);
  }

  const cyclesByComp = new Map<number, RawCycle[]>();
  for (const c of rawCycles) {
    if (c.vertices.length === 0) continue;
    const root = find(c.vertices[0]);
    if (!cyclesByComp.has(root)) cyclesByComp.set(root, []);
    cyclesByComp.get(root)!.push(c);
  }

  interface ComponentFaces {
    compRoot: number;
    outerPath: paper.Path;
    outerArea: number;
    interiorCycles: RawCycle[];
  }

  const componentFaceGroups: ComponentFaces[] = [];

  for (const [compRoot, compCycles] of cyclesByComp.entries()) {
    if (compCycles.length === 0) continue;
    // Sort by absArea descending; largest is the outer boundary of this component
    compCycles.sort((a, b) => b.absArea - a.absArea);
    const outer = compCycles[0];
    const outerSign = Math.sign(outer.signedArea);

    const interiorCycles = compCycles
      .slice(1)
      .filter((c) => Math.sign(c.signedArea) !== outerSign || compCycles.length === 2);

    componentFaceGroups.push({
      compRoot,
      outerPath: outer.path,
      outerArea: outer.absArea,
      interiorCycles,
    });
  }

  // Build final PlanarFaces (resolving island holes where one component sits strictly inside another component's face)
  const faces: PlanarFace[] = [];
  let faceCounter = 1;

  for (let gIdx = 0; gIdx < componentFaceGroups.length; gIdx++) {
    const group = componentFaceGroups[gIdx];
    for (const cycle of group.interiorCycles) {
      let faceItem: paper.PathItem = cycle.path.clone({ insert: false });
      if ((faceItem as paper.Path).area < 0) {
        (faceItem as paper.Path).reverse();
      }

      // Check if any smaller connected component sits strictly inside this cycle
      for (let otherIdx = 0; otherIdx < componentFaceGroups.length; otherIdx++) {
        if (otherIdx === gIdx) continue;
        const other = componentFaceGroups[otherIdx];
        if (other.outerArea >= cycle.absArea) continue;
        const samplePt = other.outerPath.firstSegment?.point;
        if (samplePt && cycle.path.contains(samplePt)) {
          const subtracted = faceItem.subtract(other.outerPath, { insert: false });
          if (subtracted) {
            faceItem = subtracted;
          }
        }
      }

      const geom = paperItemToFaceGeometry(faceItem);
      if (!geom) continue;

      const interiorPt = findInteriorPoint(faceItem);

      // Determine inherited style from topmost originally-closed shape containing interiorPt
      let inheritedStyle: ShapeStyle | null = null;
      let wasOriginallyFilled = false;
      const ptPaper = new scope.Point(interiorPt.x, interiorPt.y);

      for (let sIdx = closedShapePaperItems.length - 1; sIdx >= 0; sIdx--) {
        const cand = closedShapePaperItems[sIdx];
        if (cand.item.contains(ptPaper)) {
          wasOriginallyFilled = true;
          if (!inheritedStyle && cand.shape.style.fill.type !== 'none') {
            inheritedStyle = structuredClone(cand.shape.style);
          } else if (!inheritedStyle) {
            inheritedStyle = structuredClone(cand.shape.style);
          }
        }
      }

      faces.push({
        id: `face-${faceCounter++}`,
        d: geom.d,
        segments: geom.segments,
        compoundPaths: geom.compoundPaths,
        area: Math.abs(
          faceItem instanceof paper.Path || faceItem instanceof paper.CompoundPath
            ? faceItem.area
            : cycle.absArea
        ),
        interiorPoint: interiorPt,
        sourceShapeIds: Array.from(cycle.sourceShapeIds),
        inheritedStyle,
        wasOriginallyFilled,
      });
    }
  }

  return { faces, danglingEdges };
}

/**
 * Executes a Shape Builder brush stroke (either merging selected faces or erasing faces/dangling edges)
 * and returns the resulting replacement VectorShapes.
 */
export function applyShapeBuilderStroke(params: {
  inputShapes: VectorShape[];
  arrangement: PlanarArrangement;
  touchedFaceIds: string[];
  touchedEdgeIds: string[];
  mode: 'merge' | 'erase';
  styleMode: ShapeBuilderOptions['styleMode'];
  activeStyle: ShapeStyle;
}): VectorShape[] {
  const {
    inputShapes,
    arrangement,
    touchedFaceIds,
    touchedEdgeIds,
    mode,
    styleMode,
    activeStyle,
  } = params;

  const scope = getPaperScope();
  const touchedFaceSet = new Set(touchedFaceIds);
  const touchedEdgeSet = new Set(touchedEdgeIds);

  if (touchedFaceSet.size === 0 && touchedEdgeSet.size === 0) {
    return inputShapes;
  }

  const faceToPaperItem = (face: PlanarFace): paper.PathItem => {
    const main = segmentsToPaperPath(scope, face.segments, true);
    if (!face.compoundPaths || face.compoundPaths.length === 0) {
      return main;
    }
    const comp = new scope.CompoundPath({ insert: false });
    comp.addChild(main);
    for (const cp of face.compoundPaths) {
      comp.addChild(segmentsToPaperPath(scope, cp.segments, cp.closed));
    }
    return comp;
  };

  const resultShapes: VectorShape[] = [];
  let shapeCounter = 1;

  if (mode === 'merge') {
    // 1. Unite all touched faces into a single merged PathShape
    const touchedFaces = arrangement.faces.filter((f) =>
      touchedFaceSet.has(f.id)
    );

    if (touchedFaces.length > 0) {
      let mergedItem: paper.PathItem = faceToPaperItem(touchedFaces[0]);
      for (let i = 1; i < touchedFaces.length; i++) {
        const nextItem = faceToPaperItem(touchedFaces[i]);
        mergedItem = mergedItem.unite(nextItem, { insert: false });
      }

      // Resolve style for the newly merged shape
      let resolvedStyle: ShapeStyle = structuredClone(activeStyle);
      const firstFilledFace = touchedFaces.find(
        (f) => f.inheritedStyle && f.inheritedStyle.fill.type !== 'none'
      );

      if (styleMode === 'always-inherit') {
        const firstAnyStyle =
          firstFilledFace?.inheritedStyle || touchedFaces[0].inheritedStyle;
        if (firstAnyStyle) {
          resolvedStyle = structuredClone(firstAnyStyle);
        }
      } else if (styleMode === 'active-or-inherit') {
        if (firstFilledFace?.inheritedStyle) {
          resolvedStyle = structuredClone(firstFilledFace.inheritedStyle);
        } else {
          resolvedStyle = structuredClone(activeStyle);
          if (resolvedStyle.fill.type === 'none') {
            resolvedStyle.fill = {
              type: 'solid',
              color: '#6366f1',
              opacity: 1,
            };
          }
        }
      } else {
        // 'always-active'
        resolvedStyle = structuredClone(activeStyle);
        if (resolvedStyle.fill.type === 'none') {
          resolvedStyle.fill = {
            type: 'solid',
            color: '#6366f1',
            opacity: 1,
          };
        }
      }

      const geom = paperItemToFaceGeometry(mergedItem);
      if (geom) {
        resultShapes.push({
          id: `sb-merged-${Date.now()}-${shapeCounter++}`,
          type: 'path',
          name: 'Merged Region',
          visible: true,
          locked: false,
          style: resolvedStyle,
          transform: { rotation: 0 },
          d: geom.d,
          segments: geom.segments,
          closed: true,
          compoundPaths: geom.compoundPaths,
        });
      }
    }

    // 2. Keep untouched faces that belonged to originally closed shapes (or still enclose unfilled regions)
    for (const face of arrangement.faces) {
      if (touchedFaceSet.has(face.id)) continue;
      if (face.wasOriginallyFilled || face.inheritedStyle) {
        resultShapes.push({
          id: `sb-face-${Date.now()}-${shapeCounter++}`,
          type: 'path',
          name: 'Region',
          visible: true,
          locked: false,
          style: structuredClone(face.inheritedStyle || activeStyle),
          transform: { rotation: 0 },
          d: face.d,
          segments: face.segments,
          closed: true,
          compoundPaths: face.compoundPaths,
        });
      } else {
        // Preserve the unfilled closed cycle so subsequent Shape Builder strokes can still fill it
        const fallbackStyle: ShapeStyle = {
          fill: { type: 'none', color: '#000000', opacity: 0 },
          stroke: structuredClone(activeStyle.stroke),
          opacity: 1,
        };
        resultShapes.push({
          id: `sb-frame-${Date.now()}-${shapeCounter++}`,
          type: 'path',
          name: 'Frame Region',
          visible: true,
          locked: false,
          style: fallbackStyle,
          transform: { rotation: 0 },
          d: face.d,
          segments: face.segments,
          closed: true,
          compoundPaths: face.compoundPaths,
        });
      }
    }

    // 3. Preserve all dangling edges so the user can trim them or keep them
    for (const edge of arrangement.danglingEdges) {
      resultShapes.push({
        id: `sb-edge-${Date.now()}-${shapeCounter++}`,
        type: 'path',
        name: 'Segment',
        visible: true,
        locked: false,
        style: {
          ...structuredClone(edge.style),
          fill: { type: 'none', color: '#000000', opacity: 0 },
        },
        transform: { rotation: 0 },
        d: edge.d,
        segments: edge.segments,
        closed: false,
      });
    }
  } else {
    // ERASE / TRIM MODE:
    // Omit touched faces and omit touched dangling edges!
    for (const face of arrangement.faces) {
      if (touchedFaceSet.has(face.id)) continue;
      const style: ShapeStyle = face.inheritedStyle
        ? structuredClone(face.inheritedStyle)
        : {
            fill: { type: 'none', color: '#000000', opacity: 0 },
            stroke: structuredClone(activeStyle.stroke),
            opacity: 1,
          };
      resultShapes.push({
        id: `sb-face-${Date.now()}-${shapeCounter++}`,
        type: 'path',
        name: 'Region',
        visible: true,
        locked: false,
        style,
        transform: { rotation: 0 },
        d: face.d,
        segments: face.segments,
        closed: true,
        compoundPaths: face.compoundPaths,
      });
    }

    for (const edge of arrangement.danglingEdges) {
      if (touchedEdgeSet.has(edge.id)) continue;
      resultShapes.push({
        id: `sb-edge-${Date.now()}-${shapeCounter++}`,
        type: 'path',
        name: 'Trimmed Segment',
        visible: true,
        locked: false,
        style: {
          ...structuredClone(edge.style),
          fill: { type: 'none', color: '#000000', opacity: 0 },
        },
        transform: { rotation: 0 },
        d: edge.d,
        segments: edge.segments,
        closed: false,
      });
    }
  }

  return resultShapes;
}

/**
 * Direct boolean operations (Unite, Subtract, Intersect, Exclude) for selected closed shapes.
 */
export function performBooleanOperation(
  shapes: VectorShape[],
  op: 'unite' | 'subtract' | 'intersect' | 'exclude'
): PathShape | null {
  if (shapes.length < 2) return null;
  const scope = getPaperScope();

  const toItem = (s: VectorShape): paper.PathItem => {
    const ps = shapeToPathShape(s, true);
    const main = segmentsToPaperPath(scope, ps.segments, true);
    if (!ps.compoundPaths || ps.compoundPaths.length === 0) return main;
    const comp = new scope.CompoundPath({ insert: false });
    comp.addChild(main);
    for (const cp of ps.compoundPaths) {
      comp.addChild(segmentsToPaperPath(scope, cp.segments, true));
    }
    return comp;
  };

  let acc = toItem(shapes[0]);
  for (let i = 1; i < shapes.length; i++) {
    const next = toItem(shapes[i]);
    acc = acc[op](next, { insert: false });
  }

  const geom = paperItemToFaceGeometry(acc);
  if (!geom) return null;

  return {
    id: `bool-${op}-${Date.now()}`,
    type: 'path',
    name: `${op.charAt(0).toUpperCase() + op.slice(1)} Shape`,
    visible: true,
    locked: false,
    style: structuredClone(shapes[0].style),
    transform: { rotation: 0 },
    d: geom.d,
    segments: geom.segments,
    closed: true,
    compoundPaths: geom.compoundPaths,
  };
}

/**
 * Hit-tests which PlanarFace (if any) or PlanarDanglingEdge lies under a canvas point.
 */
export function hitTestArrangement(
  arrangement: PlanarArrangement,
  point: Point,
  edgeTolerance = 6
): { faceId: string | null; edgeId: string | null } {
  const scope = getPaperScope();
  const pt = new scope.Point(point.x, point.y);

  // 1. Check dangling edges within edgeTolerance first so trimming thin lines is easy
  for (const edge of arrangement.danglingEdges) {
    const p = segmentsToPaperPath(scope, edge.segments, false);
    const loc = p.getNearestLocation(pt);
    if (loc && loc.point.getDistance(pt) <= edgeTolerance) {
      return { faceId: null, edgeId: edge.id };
    }
  }

  // 2. Check enclosed faces (smallest area first if nested)
  const sortedFaces = [...arrangement.faces].sort((a, b) => a.area - b.area);
  for (const face of sortedFaces) {
    const main = segmentsToPaperPath(scope, face.segments, true);
    let item: paper.PathItem = main;
    if (face.compoundPaths && face.compoundPaths.length > 0) {
      const comp = new scope.CompoundPath({ insert: false });
      comp.addChild(main);
      for (const cp of face.compoundPaths) {
        comp.addChild(segmentsToPaperPath(scope, cp.segments, cp.closed));
      }
      item = comp;
    }
    if (item.contains(pt)) {
      return { faceId: face.id, edgeId: null };
    }
  }

  return { faceId: null, edgeId: null };
}
