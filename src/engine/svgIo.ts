import paper from 'paper';
import { invoke } from '@tauri-apps/api/core';
import { open as tauriOpen, save as tauriSave } from '@tauri-apps/plugin-dialog';
import {
  BezierSegment,
  DocumentState,
  FillStyle,
  GradientDef,
  PathShape,
  ReferenceLayer,
  ShapeStyle,
  StrokeCap,
  StrokeJoin,
  VectorLayer,
  VectorShape,
} from '../types/document';
import {
  getShapeBoundingBox,
  roundNum,
  segmentsToPathData,
  shapeToSvgPathData,
} from './geometry';

let importScope: paper.PaperScope | null = null;

function getImportScope(): paper.PaperScope {
  if (!importScope) {
    importScope = new paper.PaperScope();
    importScope.setup(new importScope.Size(4000, 4000));
  } else {
    importScope.activate();
    importScope.project.clear();
  }
  return importScope;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStyleAttrs(style: ShapeStyle): string {
  const attrs: string[] = [];

  if (style.fill.type === 'none' || style.fill.opacity <= 0) {
    attrs.push('fill="none"');
  } else if (
    (style.fill.type === 'linear-gradient' ||
      style.fill.type === 'radial-gradient') &&
    style.fill.gradientId
  ) {
    attrs.push(`fill="url(#${escapeXml(style.fill.gradientId)})"`);
    if (style.fill.opacity < 1) {
      attrs.push(`fill-opacity="${roundNum(style.fill.opacity, 3)}"`);
    }
  } else {
    attrs.push(`fill="${escapeXml(style.fill.color)}"`);
    if (style.fill.opacity < 1) {
      attrs.push(`fill-opacity="${roundNum(style.fill.opacity, 3)}"`);
    }
  }

  if (style.stroke.width > 0 && style.stroke.opacity > 0) {
    attrs.push(`stroke="${escapeXml(style.stroke.color)}"`);
    attrs.push(`stroke-width="${roundNum(style.stroke.width, 2)}"`);
    if (style.stroke.opacity < 1) {
      attrs.push(`stroke-opacity="${roundNum(style.stroke.opacity, 3)}"`);
    }
    if (style.stroke.cap && style.stroke.cap !== 'butt') {
      attrs.push(`stroke-linecap="${style.stroke.cap}"`);
    }
    if (style.stroke.join && style.stroke.join !== 'miter') {
      attrs.push(`stroke-linejoin="${style.stroke.join}"`);
    }
    if (style.stroke.dashArray && style.stroke.dashArray.length > 0) {
      attrs.push(`stroke-dasharray="${style.stroke.dashArray.join(' ')}"`);
    }
  } else {
    attrs.push('stroke="none"');
  }

  if (style.opacity < 1) {
    attrs.push(`opacity="${roundNum(style.opacity, 3)}"`);
  }

  return attrs.join(' ');
}

function shapeToSvgElement(shape: VectorShape, indent = '    '): string {
  if (!shape.visible) return '';
  const bbox = getShapeBoundingBox(shape);
  const rot = shape.transform.rotation;
  const transformAttr = rot
    ? ` transform="rotate(${roundNum(rot)} ${roundNum(bbox.cx)} ${roundNum(bbox.cy)})"`
    : '';
  const styleAttrs = formatStyleAttrs(shape.style);
  const idAttr = `id="${escapeXml(shape.id)}" data-name="${escapeXml(shape.name)}"`;

  switch (shape.type) {
    case 'rect': {
      const rxAttr =
        shape.rx > 0 ? ` rx="${roundNum(shape.rx)}" ry="${roundNum(shape.ry || shape.rx)}"` : '';
      return `${indent}<rect ${idAttr} x="${roundNum(shape.x)}" y="${roundNum(shape.y)}" width="${roundNum(shape.width)}" height="${roundNum(shape.height)}"${rxAttr} ${styleAttrs}${transformAttr} />`;
    }
    case 'ellipse': {
      if (Math.abs(shape.rx - shape.ry) < 1e-3) {
        return `${indent}<circle ${idAttr} cx="${roundNum(shape.cx)}" cy="${roundNum(shape.cy)}" r="${roundNum(shape.rx)}" ${styleAttrs}${transformAttr} />`;
      }
      return `${indent}<ellipse ${idAttr} cx="${roundNum(shape.cx)}" cy="${roundNum(shape.cy)}" rx="${roundNum(shape.rx)}" ry="${roundNum(shape.ry)}" ${styleAttrs}${transformAttr} />`;
    }
    case 'line':
      return `${indent}<line ${idAttr} x1="${roundNum(shape.x1)}" y1="${roundNum(shape.y1)}" x2="${roundNum(shape.x2)}" y2="${roundNum(shape.y2)}" ${styleAttrs}${transformAttr} />`;
    case 'spline':
    case 'path': {
      const d = shapeToSvgPathData(shape, false);
      return `${indent}<path ${idAttr} d="${d}" ${styleAttrs}${transformAttr} />`;
    }
  }
}

export function exportDocumentToSvg(
  doc: DocumentState,
  options: { includeReferenceLayers?: boolean } = {}
): string {
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width}" height="${doc.height}">`
  );

  if (doc.gradients.length > 0) {
    lines.push('  <defs>');
    for (const grad of doc.gradients) {
      if (grad.type === 'linear') {
        lines.push(
          `    <linearGradient id="${escapeXml(grad.id)}" x1="${grad.x1 * 100}%" y1="${grad.y1 * 100}%" x2="${grad.x2 * 100}%" y2="${grad.y2 * 100}%">`
        );
        for (const s of grad.stops) {
          lines.push(
            `      <stop offset="${Math.round(s.offset * 100)}%" stop-color="${escapeXml(s.color)}" stop-opacity="${s.opacity}" />`
          );
        }
        lines.push('    </linearGradient>');
      } else {
        lines.push(
          `    <radialGradient id="${escapeXml(grad.id)}" cx="50%" cy="50%" r="50%">`
        );
        for (const s of grad.stops) {
          lines.push(
            `      <stop offset="${Math.round(s.offset * 100)}%" stop-color="${escapeXml(s.color)}" stop-opacity="${s.opacity}" />`
          );
        }
        lines.push('    </radialGradient>');
      }
    }
    lines.push('  </defs>');
  }

  if (!doc.transparentBackground && doc.backgroundColor) {
    lines.push(
      `  <rect id="artboard-bg" width="${doc.width}" height="${doc.height}" fill="${escapeXml(doc.backgroundColor)}" />`
    );
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'reference') {
      if (options.includeReferenceLayers || layer.exportWithSvg) {
        const rotAttr = layer.rotation
          ? ` transform="rotate(${roundNum(layer.rotation)} ${roundNum(layer.x + layer.width / 2)} ${roundNum(layer.y + layer.height / 2)})"`
          : '';
        lines.push(
          `  <image id="${escapeXml(layer.id)}" data-reference="true" href="${layer.dataUrl}" x="${roundNum(layer.x)}" y="${roundNum(layer.y)}" width="${roundNum(layer.width)}" height="${roundNum(layer.height)}" opacity="${roundNum(layer.opacity, 3)}"${rotAttr} />`
        );
      }
      continue;
    }

    const opAttr =
      layer.opacity < 1 ? ` opacity="${roundNum(layer.opacity, 3)}"` : '';
    lines.push(
      `  <g id="${escapeXml(layer.id)}" data-layer-name="${escapeXml(layer.name)}"${opAttr}>`
    );
    for (const shape of layer.shapes) {
      const el = shapeToSvgElement(shape, '    ');
      if (el) lines.push(el);
    }
    lines.push('  </g>');
  }

  lines.push('</svg>');
  return lines.join('\n');
}

function parseStyleFromElement(el: Element): ShapeStyle {
  const inlineStyle = el.getAttribute('style') || '';
  const styleMap: Record<string, string> = {};
  inlineStyle.split(';').forEach((part) => {
    const [k, v] = part.split(':').map((s) => s.trim());
    if (k && v) styleMap[k] = v;
  });

  const getAttr = (name: string): string | null =>
    styleMap[name] ?? el.getAttribute(name);

  const rawFill = getAttr('fill');
  const fillOpacity = parseFloat(getAttr('fill-opacity') || '1');
  let fill: FillStyle = {
    type: 'solid',
    color: '#6366f1',
    opacity: isNaN(fillOpacity) ? 1 : fillOpacity,
  };

  if (rawFill === 'none' || rawFill === 'transparent') {
    fill = { type: 'none', color: '#000000', opacity: 0 };
  } else if (rawFill && rawFill.startsWith('url(#')) {
    const gradId = rawFill.slice(5, -1).replace(/['"]/g, '');
    fill = {
      type: 'linear-gradient',
      color: '#6366f1',
      opacity: isNaN(fillOpacity) ? 1 : fillOpacity,
      gradientId: gradId,
    };
  } else if (rawFill) {
    fill = {
      type: 'solid',
      color: rawFill,
      opacity: isNaN(fillOpacity) ? 1 : fillOpacity,
    };
  } else if (el.tagName.toLowerCase() === 'line' || el.tagName.toLowerCase() === 'polyline') {
    fill = { type: 'none', color: '#000000', opacity: 0 };
  }

  const rawStroke = getAttr('stroke');
  const rawStrokeWidth = parseFloat(getAttr('stroke-width') || '1.5');
  const strokeOpacity = parseFloat(getAttr('stroke-opacity') || '1');
  const strokeCap = (getAttr('stroke-linecap') || 'round') as StrokeCap;
  const strokeJoin = (getAttr('stroke-linejoin') || 'round') as StrokeJoin;
  const rawDash = getAttr('stroke-dasharray');
  const dashArray = rawDash && rawDash !== 'none'
    ? rawDash
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0)
    : [];

  const hasStroke = rawStroke && rawStroke !== 'none' && rawStroke !== 'transparent';
  const stroke = {
    color: hasStroke ? rawStroke! : '#1e293b',
    width: hasStroke ? (isNaN(rawStrokeWidth) ? 1.5 : rawStrokeWidth) : 0,
    opacity: isNaN(strokeOpacity) ? 1 : strokeOpacity,
    cap: strokeCap,
    join: strokeJoin,
    dashArray,
  };

  const opacity = parseFloat(getAttr('opacity') || '1');

  return {
    fill,
    stroke,
    opacity: isNaN(opacity) ? 1 : opacity,
  };
}

function parseRotationFromTransform(el: Element): number {
  const tf = el.getAttribute('transform') || '';
  const match = tf.match(/rotate\(\s*([-\d.]+)/);
  if (match) {
    const deg = parseFloat(match[1]);
    return isNaN(deg) ? 0 : deg;
  }
  return 0;
}

function svgPathDataToPathShape(
  d: string,
  id: string,
  name: string,
  style: ShapeStyle,
  rotation: number
): PathShape | null {
  const scope = getImportScope();
  const item: paper.PathItem = new scope.CompoundPath(d);

  const toSegments = (p: paper.Path): BezierSegment[] =>
    p.segments.map((s) => ({
      point: { x: s.point.x, y: s.point.y },
      handleIn: { x: s.handleIn.x, y: s.handleIn.y },
      handleOut: { x: s.handleOut.x, y: s.handleOut.y },
    }));

  if (item instanceof paper.CompoundPath) {
    const children = (item.children as paper.Path[]).filter(
      (c) => c.segments && c.segments.length >= 2
    );
    if (children.length === 0) return null;
    const main = children[0];
    const mainSegs = toSegments(main);
    const compoundPaths =
      children.length > 1
        ? children.slice(1).map((c) => ({
            segments: toSegments(c),
            closed: c.closed,
          }))
        : undefined;
    return {
      id,
      type: 'path',
      name,
      visible: true,
      locked: false,
      style,
      transform: { rotation },
      d: segmentsToPathData(mainSegs, main.closed, compoundPaths),
      segments: mainSegs,
      closed: main.closed,
      compoundPaths,
    };
  } else if (item instanceof paper.Path) {
    if (item.segments.length < 2) return null;
    const segs = toSegments(item);
    return {
      id,
      type: 'path',
      name,
      visible: true,
      locked: false,
      style,
      transform: { rotation },
      d: segmentsToPathData(segs, item.closed),
      segments: segs,
      closed: item.closed,
    };
  }
  return null;
}

function elementToVectorShape(
  el: Element,
  counter: { val: number }
): VectorShape | null {
  const tag = el.tagName.toLowerCase();
  if (el.getAttribute('id') === 'artboard-bg') return null;

  const id = el.getAttribute('id') || `imported-shape-${Date.now()}-${counter.val++}`;
  const name =
    el.getAttribute('data-name') ||
    el.getAttribute('id') ||
    `${tag.charAt(0).toUpperCase() + tag.slice(1)} ${counter.val}`;
  const style = parseStyleFromElement(el);
  const rotation = parseRotationFromTransform(el);

  switch (tag) {
    case 'rect': {
      const x = parseFloat(el.getAttribute('x') || '0');
      const y = parseFloat(el.getAttribute('y') || '0');
      const width = parseFloat(el.getAttribute('width') || '100');
      const height = parseFloat(el.getAttribute('height') || '100');
      const rx = parseFloat(el.getAttribute('rx') || '0');
      const ry = parseFloat(el.getAttribute('ry') || String(rx));
      return {
        id,
        type: 'rect',
        name,
        visible: true,
        locked: false,
        style,
        transform: { rotation },
        x,
        y,
        width,
        height,
        rx,
        ry,
      };
    }
    case 'circle': {
      const cx = parseFloat(el.getAttribute('cx') || '0');
      const cy = parseFloat(el.getAttribute('cy') || '0');
      const r = parseFloat(el.getAttribute('r') || '50');
      return {
        id,
        type: 'ellipse',
        name,
        visible: true,
        locked: false,
        style,
        transform: { rotation },
        cx,
        cy,
        rx: r,
        ry: r,
      };
    }
    case 'ellipse': {
      const cx = parseFloat(el.getAttribute('cx') || '0');
      const cy = parseFloat(el.getAttribute('cy') || '0');
      const rx = parseFloat(el.getAttribute('rx') || '50');
      const ry = parseFloat(el.getAttribute('ry') || '50');
      return {
        id,
        type: 'ellipse',
        name,
        visible: true,
        locked: false,
        style,
        transform: { rotation },
        cx,
        cy,
        rx,
        ry,
      };
    }
    case 'line': {
      const x1 = parseFloat(el.getAttribute('x1') || '0');
      const y1 = parseFloat(el.getAttribute('y1') || '0');
      const x2 = parseFloat(el.getAttribute('x2') || '100');
      const y2 = parseFloat(el.getAttribute('y2') || '100');
      return {
        id,
        type: 'line',
        name,
        visible: true,
        locked: false,
        style,
        transform: { rotation },
        x1,
        y1,
        x2,
        y2,
      };
    }
    case 'polygon':
    case 'polyline': {
      const ptsRaw = (el.getAttribute('points') || '').trim();
      const nums = ptsRaw
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => !isNaN(n));
      const segments: BezierSegment[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        segments.push({
          point: { x: nums[i], y: nums[i + 1] },
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
        });
      }
      if (segments.length < 2) return null;
      const closed = tag === 'polygon';
      return {
        id,
        type: 'path',
        name,
        visible: true,
        locked: false,
        style,
        transform: { rotation },
        d: segmentsToPathData(segments, closed),
        segments,
        closed,
      };
    }
    case 'path': {
      const d = el.getAttribute('d') || '';
      if (!d.trim()) return null;
      return svgPathDataToPathShape(d, id, name, style, rotation);
    }
    default:
      return null;
  }
}

export function parseSvgToLayers(svgText: string): {
  width: number;
  height: number;
  layers: VectorLayer[];
  gradients: GradientDef[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) {
    throw new Error('Invalid SVG document: missing <svg> root element.');
  }

  let width = parseFloat(svgEl.getAttribute('width') || '0');
  let height = parseFloat(svgEl.getAttribute('height') || '0');
  const viewBox = svgEl.getAttribute('viewBox');
  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && !isNaN(parts[2]) && !isNaN(parts[3])) {
      width = parts[2];
      height = parts[3];
    }
  }
  if (!width || isNaN(width)) width = 1000;
  if (!height || isNaN(height)) height = 750;

  const gradients: GradientDef[] = [];
  svgEl.querySelectorAll('linearGradient, radialGradient').forEach((gradEl, idx) => {
    const id = gradEl.getAttribute('id') || `grad-${idx + 1}`;
    const isRadial = gradEl.tagName.toLowerCase() === 'radialgradient';
    const stops = Array.from(gradEl.querySelectorAll('stop')).map((stopEl) => {
      const rawOff = stopEl.getAttribute('offset') || '0';
      const offset = rawOff.endsWith('%')
        ? parseFloat(rawOff) / 100
        : parseFloat(rawOff);
      const color = stopEl.getAttribute('stop-color') || '#6366f1';
      const opacity = parseFloat(stopEl.getAttribute('stop-opacity') || '1');
      return {
        offset: isNaN(offset) ? 0 : Math.max(0, Math.min(1, offset)),
        color,
        opacity: isNaN(opacity) ? 1 : opacity,
      };
    });
    if (stops.length >= 2) {
      gradients.push({
        id,
        name: id,
        type: isRadial ? 'radial' : 'linear',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        stops,
      });
    }
  });

  const layers: VectorLayer[] = [];
  const rootLooseShapes: VectorShape[] = [];
  const counter = { val: 1 };

  const collectShapesRecursively = (parent: Element, out: VectorShape[]) => {
    Array.from(parent.children).forEach((child) => {
      const tag = child.tagName.toLowerCase();
      if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata') {
        return;
      }
      if (tag === 'g') {
        collectShapesRecursively(child, out);
      } else {
        const shape = elementToVectorShape(child, counter);
        if (shape) out.push(shape);
      }
    });
  };

  Array.from(svgEl.children).forEach((child, idx) => {
    const tag = child.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata') {
      return;
    }
    if (tag === 'g') {
      const groupShapes: VectorShape[] = [];
      collectShapesRecursively(child, groupShapes);
      if (groupShapes.length > 0) {
        const layerName =
          child.getAttribute('data-layer-name') ||
          child.getAttribute('inkscape:label') ||
          child.getAttribute('id') ||
          `Layer ${layers.length + 1}`;
        const op = parseFloat(child.getAttribute('opacity') || '1');
        layers.push({
          id: child.getAttribute('id') || `layer-import-${Date.now()}-${idx}`,
          type: 'vector',
          name: layerName,
          visible: true,
          locked: false,
          opacity: isNaN(op) ? 1 : op,
          expanded: true,
          shapes: groupShapes,
        });
      }
    } else {
      const shape = elementToVectorShape(child, counter);
      if (shape) rootLooseShapes.push(shape);
    }
  });

  if (rootLooseShapes.length > 0) {
    layers.push({
      id: `layer-root-${Date.now()}`,
      type: 'vector',
      name: layers.length === 0 ? 'Layer 1' : 'Imported Shapes',
      visible: true,
      locked: false,
      opacity: 1,
      expanded: true,
      shapes: rootLooseShapes,
    });
  }

  if (layers.length === 0) {
    layers.push({
      id: `layer-empty-${Date.now()}`,
      type: 'vector',
      name: 'Layer 1',
      visible: true,
      locked: false,
      opacity: 1,
      expanded: true,
      shapes: [],
    });
  }

  return { width, height, layers, gradients };
}

export function serializeProject(doc: DocumentState): string {
  return JSON.stringify(
    {
      format: 'svg-svg-no-mi-project',
      version: 1,
      document: doc,
    },
    null,
    2
  );
}

export function deserializeProject(jsonText: string): DocumentState {
  const parsed = JSON.parse(jsonText);
  if (parsed && parsed.format === 'svg-svg-no-mi-project' && parsed.document) {
    return parsed.document as DocumentState;
  }
  throw new Error('Invalid .ssnm project file.');
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function saveTextWithDialog(
  defaultFileName: string,
  contents: string,
  filterName: string,
  extensions: string[]
): Promise<boolean> {
  if (isTauriEnvironment()) {
    const filePath = await tauriSave({
      defaultPath: defaultFileName,
      filters: [{ name: filterName, extensions }],
    });
    if (!filePath) return false;
    await invoke('save_text_file', { path: filePath, contents });
    return true;
  } else {
    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultFileName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }
}

export async function openTextWithDialog(
  filterName: string,
  extensions: string[]
): Promise<{ name: string; contents: string } | null> {
  if (isTauriEnvironment()) {
    const selected = await tauriOpen({
      multiple: false,
      filters: [{ name: filterName, extensions }],
    });
    if (!selected || typeof selected !== 'string') return null;
    const contents = await invoke<string>('read_text_file', { path: selected });
    const name = selected.split(/[/\\]/).pop() || 'document';
    return { name, contents };
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = extensions.map((ext) => `.${ext}`).join(',');
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          resolve({ name: file.name, contents: String(reader.result || '') });
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }
}

export async function openReferencePngWithDialog(): Promise<{
  name: string;
  dataUrl: string;
  width: number;
  height: number;
} | null> {
  const loadImageDimensions = (
    dataUrl: string,
    name: string
  ): Promise<{ name: string; dataUrl: string; width: number; height: number }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          name: name.replace(/\.[^.]+$/, ''),
          dataUrl,
          width: img.naturalWidth || 600,
          height: img.naturalHeight || 600,
        });
      };
      img.onerror = () => reject(new Error('Failed to decode reference PNG'));
      img.src = dataUrl;
    });

  if (isTauriEnvironment()) {
    const selected = await tauriOpen({
      multiple: false,
      filters: [{ name: 'Reference Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!selected || typeof selected !== 'string') return null;
    const bytes = await invoke<number[]>('read_binary_file', { path: selected });
    const uint8 = new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);
    const ext = selected.split('.').pop()?.toLowerCase() || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = `data:${mime};base64,${base64}`;
    const name = selected.split(/[/\\]/).pop() || 'Reference';
    return loadImageDimensions(dataUrl, name);
  } else {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.png,.jpg,.jpeg,.webp';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const res = await loadImageDimensions(
              String(reader.result || ''),
              file.name
            );
            resolve(res);
          } catch {
            resolve(null);
          }
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }
}

export async function exportPngWithDialog(
  doc: DocumentState,
  scale = 2
): Promise<boolean> {
  const svgString = exportDocumentToSvg(doc, { includeReferenceLayers: false });
  const svgBlob = new Blob([svgString], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(svgBlob);

  const pngBytes: Uint8Array = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(doc.width * scale);
      canvas.height = Math.round(doc.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('PNG encoding failed'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      }, 'image/png');
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });

  const defaultName = `${doc.name.toLowerCase().replace(/\s+/g, '-')}.png`;
  if (isTauriEnvironment()) {
    const filePath = await tauriSave({
      defaultPath: defaultName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (!filePath) return false;
    await invoke('save_binary_file', {
      path: filePath,
      bytes: Array.from(pngBytes),
    });
    return true;
  } else {
    const blob = new Blob([pngBytes.buffer as ArrayBuffer], { type: 'image/png' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(dlUrl);
    return true;
  }
}
