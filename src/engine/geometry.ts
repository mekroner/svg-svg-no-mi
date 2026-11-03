import {
  BezierSegment,
  BoundingBox,
  EllipseShape,
  LineShape,
  PathShape,
  Point,
  RectShape,
  SplinePoint,
  SplineShape,
  VectorShape,
} from '../types/document';

const KAPPA = 0.5522847498307936; // 4 * (sqrt(2) - 1) / 3

export function roundNum(n: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function rotatePoint(p: Point, center: Point, angleDeg: number): Point {
  if (!angleDeg) return { x: p.x, y: p.y };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * Converts a list of pass-through SplinePoints into cubic BezierSegments
 * using chord-aware Catmull-Rom / Cardinal tangents so the curve passes
 * smoothly through every point without self-intersecting loops.
 */
export function splineToBezierSegments(
  points: SplinePoint[],
  closed: boolean,
  tension = 0.5
): BezierSegment[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) {
    return [
      {
        point: { x: points[0].x, y: points[0].y },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      },
    ];
  }

  const segments: BezierSegment[] = [];
  // Scale factor: tension=0.5 gives standard Catmull-Rom (1/6 of secant or ~1/3 of chord)
  const k = Math.max(0, Math.min(1, tension)) * 0.66;

  for (let i = 0; i < n; i++) {
    const curr = points[i];
    if (!curr.smooth || (!closed && (i === 0 || i === n - 1) && n === 2)) {
      segments.push({
        point: { x: curr.x, y: curr.y },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      });
      continue;
    }

    const prev =
      i === 0 ? (closed ? points[n - 1] : points[0]) : points[i - 1];
    const next =
      i === n - 1 ? (closed ? points[0] : points[n - 1]) : points[i + 1];

    // Endpoints of an open spline with >= 3 points:
    if (!closed && i === 0) {
      // Natural tangent toward next point influenced by point[1]'s direction
      const dx = next.x - curr.x;
      const dy = next.y - curr.y;
      segments.push({
        point: { x: curr.x, y: curr.y },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: dx * (k * 0.5), y: dy * (k * 0.5) },
      });
      continue;
    }

    if (!closed && i === n - 1) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      segments.push({
        point: { x: curr.x, y: curr.y },
        handleIn: { x: -dx * (k * 0.5), y: -dy * (k * 0.5) },
        handleOut: { x: 0, y: 0 },
      });
      continue;
    }

    // Interior point (or any point on a closed spline)
    const secantX = next.x - prev.x;
    const secantY = next.y - prev.y;
    const secantLen = Math.hypot(secantX, secantY);

    if (secantLen < 1e-6) {
      segments.push({
        point: { x: curr.x, y: curr.y },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      });
      continue;
    }

    const dirX = secantX / secantLen;
    const dirY = secantY / secantLen;

    const dPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const dNext = Math.hypot(next.x - curr.x, next.y - curr.y);

    const inLen = dPrev * k;
    const outLen = dNext * k;

    segments.push({
      point: { x: curr.x, y: curr.y },
      handleIn: { x: -dirX * inLen, y: -dirY * inLen },
      handleOut: { x: dirX * outLen, y: dirY * outLen },
    });
  }

  return segments;
}

export function singleSubpathToSvg(
  segments: BezierSegment[],
  closed: boolean
): string {
  if (segments.length === 0) return '';
  const first = segments[0];
  const parts: string[] = [
    `M ${roundNum(first.point.x)} ${roundNum(first.point.y)}`,
  ];

  const count = closed ? segments.length : segments.length - 1;
  for (let i = 0; i < count; i++) {
    const curr = segments[i];
    const next = segments[(i + 1) % segments.length];

    const hasOut =
      Math.abs(curr.handleOut.x) > 1e-3 || Math.abs(curr.handleOut.y) > 1e-3;
    const hasIn =
      Math.abs(next.handleIn.x) > 1e-3 || Math.abs(next.handleIn.y) > 1e-3;

    if (!hasOut && !hasIn) {
      parts.push(`L ${roundNum(next.point.x)} ${roundNum(next.point.y)}`);
    } else {
      const cp1x = curr.point.x + curr.handleOut.x;
      const cp1y = curr.point.y + curr.handleOut.y;
      const cp2x = next.point.x + next.handleIn.x;
      const cp2y = next.point.y + next.handleIn.y;
      parts.push(
        `C ${roundNum(cp1x)} ${roundNum(cp1y)}, ${roundNum(cp2x)} ${roundNum(cp2y)}, ${roundNum(next.point.x)} ${roundNum(next.point.y)}`
      );
    }
  }

  if (closed && segments.length > 1) {
    parts.push('Z');
  }
  return parts.join(' ');
}

export function segmentsToPathData(
  segments: BezierSegment[],
  closed: boolean,
  compoundPaths?: { segments: BezierSegment[]; closed: boolean }[]
): string {
  const main = singleSubpathToSvg(segments, closed);
  if (!compoundPaths || compoundPaths.length === 0) {
    return main;
  }
  const subStrings = compoundPaths
    .map((cp) => singleSubpathToSvg(cp.segments, cp.closed))
    .filter(Boolean);
  return [main, ...subStrings].filter(Boolean).join(' ');
}

export function rectToBezierSegments(rect: RectShape): BezierSegment[] {
  const { x, y, width: w, height: h } = rect;
  const rx = Math.min(Math.max(0, rect.rx || 0), w / 2);
  const ry = Math.min(Math.max(0, rect.ry || rect.rx || 0), h / 2);

  if (rx <= 1e-3 || ry <= 1e-3) {
    return [
      { point: { x, y }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
      {
        point: { x: x + w, y },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      },
      {
        point: { x: x + w, y: y + h },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      },
      {
        point: { x, y: y + h },
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      },
    ];
  }

  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  return [
    {
      point: { x: x + rx, y },
      handleIn: { x: -kx, y: 0 },
      handleOut: { x: 0, y: 0 },
    },
    {
      point: { x: x + w - rx, y },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: kx, y: 0 },
    },
    {
      point: { x: x + w, y: y + ry },
      handleIn: { x: 0, y: -ky },
      handleOut: { x: 0, y: 0 },
    },
    {
      point: { x: x + w, y: y + h - ry },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: ky },
    },
    {
      point: { x: x + w - rx, y: y + h },
      handleIn: { x: kx, y: 0 },
      handleOut: { x: 0, y: 0 },
    },
    {
      point: { x: x + rx, y: y + h },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: -kx, y: 0 },
    },
    {
      point: { x, y: y + h - ry },
      handleIn: { x: 0, y: ky },
      handleOut: { x: 0, y: 0 },
    },
    {
      point: { x, y: y + ry },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: -ky },
    },
  ];
}

export function ellipseToBezierSegments(
  ellipse: EllipseShape
): BezierSegment[] {
  const { cx, cy, rx, ry } = ellipse;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  return [
    {
      point: { x: cx, y: cy - ry },
      handleIn: { x: -kx, y: 0 },
      handleOut: { x: kx, y: 0 },
    },
    {
      point: { x: cx + rx, y: cy },
      handleIn: { x: 0, y: -ky },
      handleOut: { x: 0, y: ky },
    },
    {
      point: { x: cx, y: cy + ry },
      handleIn: { x: kx, y: 0 },
      handleOut: { x: -kx, y: 0 },
    },
    {
      point: { x: cx - rx, y: cy },
      handleIn: { x: 0, y: ky },
      handleOut: { x: 0, y: -ky },
    },
  ];
}

export function lineToBezierSegments(line: LineShape): BezierSegment[] {
  return [
    {
      point: { x: line.x1, y: line.y1 },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    },
    {
      point: { x: line.x2, y: line.y2 },
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    },
  ];
}

export function rotateBezierSegments(
  segments: BezierSegment[],
  center: Point,
  angleDeg: number
): BezierSegment[] {
  if (!angleDeg) return segments;
  const origin = { x: 0, y: 0 };
  return segments.map((seg) => ({
    point: rotatePoint(seg.point, center, angleDeg),
    handleIn: rotatePoint(seg.handleIn, origin, angleDeg),
    handleOut: rotatePoint(seg.handleOut, origin, angleDeg),
  }));
}

/**
 * Converts any VectorShape into a PathShape, baking in rotation if requested.
 */
export function shapeToPathShape(
  shape: VectorShape,
  bakeRotation = true
): PathShape {
  const bbox = getShapeBoundingBox(shape);
  const center = { x: bbox.cx, y: bbox.cy };
  const rot = bakeRotation ? shape.transform.rotation : 0;

  if (shape.type === 'path') {
    if (!rot) return shape;
    const rotatedSegments = rotateBezierSegments(shape.segments, center, rot);
    const rotatedCompound = shape.compoundPaths?.map((cp) => ({
      closed: cp.closed,
      segments: rotateBezierSegments(cp.segments, center, rot),
    }));
    const d = segmentsToPathData(
      rotatedSegments,
      shape.closed,
      rotatedCompound
    );
    return {
      ...shape,
      d,
      segments: rotatedSegments,
      compoundPaths: rotatedCompound,
      transform: { rotation: 0 },
    };
  }

  let segments: BezierSegment[] = [];
  let closed = true;

  switch (shape.type) {
    case 'rect':
      segments = rectToBezierSegments(shape);
      closed = true;
      break;
    case 'ellipse':
      segments = ellipseToBezierSegments(shape);
      closed = true;
      break;
    case 'line':
      segments = lineToBezierSegments(shape);
      closed = false;
      break;
    case 'spline':
      segments = splineToBezierSegments(
        shape.points,
        shape.closed,
        shape.tension
      );
      closed = shape.closed;
      break;
  }

  if (rot) {
    segments = rotateBezierSegments(segments, center, rot);
  }

  const d = segmentsToPathData(segments, closed);

  return {
    id: shape.id,
    type: 'path',
    name: shape.name,
    visible: shape.visible,
    locked: shape.locked,
    style: structuredClone(shape.style),
    transform: { rotation: bakeRotation ? 0 : shape.transform.rotation },
    d,
    segments,
    closed,
  };
}

export function shapeToSvgPathData(
  shape: VectorShape,
  bakeRotation = false
): string {
  if (shape.type === 'path' && !bakeRotation) {
    return (
      shape.d ||
      segmentsToPathData(shape.segments, shape.closed, shape.compoundPaths)
    );
  }
  const asPath = shapeToPathShape(shape, bakeRotation);
  return asPath.d;
}

export function evaluateCubicBezier(
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  t: number
): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p3.y,
  };
}

export function getShapeBoundingBox(shape: VectorShape): BoundingBox {
  if (shape.type === 'rect') {
    return {
      x: shape.x,
      y: shape.y,
      width: Math.max(1, shape.width),
      height: Math.max(1, shape.height),
      cx: shape.x + shape.width / 2,
      cy: shape.y + shape.height / 2,
    };
  }
  if (shape.type === 'ellipse') {
    return {
      x: shape.cx - shape.rx,
      y: shape.cy - shape.ry,
      width: Math.max(1, shape.rx * 2),
      height: Math.max(1, shape.ry * 2),
      cx: shape.cx,
      cy: shape.cy,
    };
  }
  if (shape.type === 'line') {
    const minX = Math.min(shape.x1, shape.x2);
    const maxX = Math.max(shape.x1, shape.x2);
    const minY = Math.min(shape.y1, shape.y2);
    const maxY = Math.max(shape.y1, shape.y2);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return {
      x: minX,
      y: minY,
      width,
      height,
      cx: ( shape.x1 + shape.x2 ) / 2,
      cy: ( shape.y1 + shape.y2 ) / 2,
    };
  }

  const segments =
    shape.type === 'spline'
      ? splineToBezierSegments(shape.points, shape.closed, shape.tension)
      : shape.segments;
  const closed = shape.closed;

  const allSubpaths = [
    { segments, closed },
    ...(shape.type === 'path' && shape.compoundPaths
      ? shape.compoundPaths
      : []),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const sub of allSubpaths) {
    const segs = sub.segments;
    if (segs.length === 0) continue;
    const count = sub.closed ? segs.length : segs.length - 1;
    if (count === 0) {
      minX = Math.min(minX, segs[0].point.x);
      maxX = Math.max(maxX, segs[0].point.x);
      minY = Math.min(minY, segs[0].point.y);
      maxY = Math.max(maxY, segs[0].point.y);
    }
    for (let i = 0; i < count; i++) {
      const curr = segs[i];
      const next = segs[(i + 1) % segs.length];
      const p0 = curr.point;
      const cp1 = {
        x: curr.point.x + curr.handleOut.x,
        y: curr.point.y + curr.handleOut.y,
      };
      const cp2 = {
        x: next.point.x + next.handleIn.x,
        y: next.point.y + next.handleIn.y,
      };
      const p3 = next.point;
      for (let s = 0; s <= 12; s++) {
        const pt = evaluateCubicBezier(p0, cp1, cp2, p3, s / 12);
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
      }
    }
  }

  if (!isFinite(minX)) {
    return { x: 0, y: 0, width: 10, height: 10, cx: 5, cy: 5 };
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
  };
}

export function getMultiBoundingBox(shapes: VectorShape[]): BoundingBox | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = getShapeBoundingBox(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
  };
}

export function translateShape(
  shape: VectorShape,
  dx: number,
  dy: number
): VectorShape {
  switch (shape.type) {
    case 'rect':
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case 'ellipse':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case 'line':
      return {
        ...shape,
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
        x2: shape.x2 + dx,
        y2: shape.y2 + dy,
      };
    case 'spline':
      return {
        ...shape,
        points: shape.points.map((p) => ({
          ...p,
          x: p.x + dx,
          y: p.y + dy,
        })),
      };
    case 'path': {
      const segments = shape.segments.map((seg) => ({
        ...seg,
        point: { x: seg.point.x + dx, y: seg.point.y + dy },
      }));
      const compoundPaths = shape.compoundPaths?.map((cp) => ({
        ...cp,
        segments: cp.segments.map((seg) => ({
          ...seg,
          point: { x: seg.point.x + dx, y: seg.point.y + dy },
        })),
      }));
      return {
        ...shape,
        segments,
        compoundPaths,
        d: segmentsToPathData(segments, shape.closed, compoundPaths),
      };
    }
  }
}

export function scaleShape(
  shape: VectorShape,
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number
): VectorShape {
  const sx = Math.abs(scaleX) < 1e-3 ? (scaleX >= 0 ? 1e-3 : -1e-3) : scaleX;
  const sy = Math.abs(scaleY) < 1e-3 ? (scaleY >= 0 ? 1e-3 : -1e-3) : scaleY;

  switch (shape.type) {
    case 'rect': {
      const x1 = originX + (shape.x - originX) * sx;
      const y1 = originY + (shape.y - originY) * sy;
      const x2 = originX + (shape.x + shape.width - originX) * sx;
      const y2 = originY + (shape.y + shape.height - originY) * sy;
      return {
        ...shape,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.max(1, Math.abs(x2 - x1)),
        height: Math.max(1, Math.abs(y2 - y1)),
        rx: shape.rx * Math.abs(sx),
        ry: shape.ry * Math.abs(sy),
      };
    }
    case 'ellipse': {
      return {
        ...shape,
        cx: originX + (shape.cx - originX) * sx,
        cy: originY + (shape.cy - originY) * sy,
        rx: Math.max(1, shape.rx * Math.abs(sx)),
        ry: Math.max(1, shape.ry * Math.abs(sy)),
      };
    }
    case 'line': {
      return {
        ...shape,
        x1: originX + (shape.x1 - originX) * sx,
        y1: originY + (shape.y1 - originY) * sy,
        x2: originX + (shape.x2 - originX) * sx,
        y2: originY + (shape.y2 - originY) * sy,
      };
    }
    case 'spline': {
      return {
        ...shape,
        points: shape.points.map((p) => ({
          ...p,
          x: originX + (p.x - originX) * sx,
          y: originY + (p.y - originY) * sy,
        })),
      };
    }
    case 'path': {
      const mapSeg = (seg: BezierSegment): BezierSegment => ({
        point: {
          x: originX + (seg.point.x - originX) * sx,
          y: originY + (seg.point.y - originY) * sy,
        },
        handleIn: {
          x: seg.handleIn.x * sx,
          y: seg.handleIn.y * sy,
        },
        handleOut: {
          x: seg.handleOut.x * sx,
          y: seg.handleOut.y * sy,
        },
      });
      const segments = shape.segments.map(mapSeg);
      const compoundPaths = shape.compoundPaths?.map((cp) => ({
        ...cp,
        segments: cp.segments.map(mapSeg),
      }));
      return {
        ...shape,
        segments,
        compoundPaths,
        d: segmentsToPathData(segments, shape.closed, compoundPaths),
      };
    }
  }
}

export function getShapeAnchorPoints(shape: VectorShape): Point[] {
  const bbox = getShapeBoundingBox(shape);
  const center = { x: bbox.cx, y: bbox.cy };
  const rot = shape.transform.rotation;

  let pts: Point[] = [];
  switch (shape.type) {
    case 'rect':
      pts = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.width, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height },
      ];
      break;
    case 'ellipse':
      pts = [
        { x: shape.cx, y: shape.cy - shape.ry },
        { x: shape.cx + shape.rx, y: shape.cy },
        { x: shape.cx, y: shape.cy + shape.ry },
        { x: shape.cx - shape.rx, y: shape.cy },
      ];
      break;
    case 'line':
      pts = [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
      ];
      break;
    case 'spline':
      pts = shape.points.map((p) => ({ x: p.x, y: p.y }));
      break;
    case 'path':
      pts = shape.segments.map((s) => ({ x: s.point.x, y: s.point.y }));
      if (shape.compoundPaths) {
        for (const cp of shape.compoundPaths) {
          for (const s of cp.segments) {
            pts.push({ x: s.point.x, y: s.point.y });
          }
        }
      }
      break;
  }

  return rot ? pts.map((p) => rotatePoint(p, center, rot)) : pts;
}

