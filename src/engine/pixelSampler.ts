import { Point, ReferenceLayer } from '../types/document';
import { rotatePoint } from './geometry';

interface CachedSamplerCanvas {
  dataUrl: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

const samplerCache = new Map<string, CachedSamplerCanvas>();

export function preloadReferenceLayerForSampling(layer: ReferenceLayer): void {
  if (typeof document === 'undefined') return;
  const existing = samplerCache.get(layer.id);
  if (existing && existing.dataUrl === layer.dataUrl) return;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || 1;
    canvas.height = img.naturalHeight || img.height || 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      samplerCache.set(layer.id, {
        dataUrl: layer.dataUrl,
        canvas,
        ctx,
        width: canvas.width,
        height: canvas.height,
      });
    }
  };
  img.src = layer.dataUrl;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Samples pixel color from the topmost visible ReferenceLayer at canvas point.
 */
export function sampleReferenceLayersAtPoint(
  point: Point,
  referenceLayers: ReferenceLayer[]
): { color: string; opacity: number; layerName: string } | null {
  // Iterate in reverse (topmost layer first)
  for (let i = referenceLayers.length - 1; i >= 0; i--) {
    const ref = referenceLayers[i];
    if (!ref.visible) continue;

    const cached = samplerCache.get(ref.id);
    if (!cached) {
      preloadReferenceLayerForSampling(ref);
      continue;
    }

    const center = {
      x: ref.x + ref.width / 2,
      y: ref.y + ref.height / 2,
    };
    const unrotated = ref.rotation
      ? rotatePoint(point, center, -ref.rotation)
      : point;

    const u = (unrotated.x - ref.x) / Math.max(1, ref.width);
    const v = (unrotated.y - ref.y) / Math.max(1, ref.height);

    if (u < 0 || u > 1 || v < 0 || v > 1) continue;

    const px = Math.min(
      cached.width - 1,
      Math.max(0, Math.floor(u * cached.width))
    );
    const py = Math.min(
      cached.height - 1,
      Math.max(0, Math.floor(v * cached.height))
    );

    const data = cached.ctx.getImageData(px, py, 1, 1).data;
    const [r, g, b, a] = data;
    if (a > 8) {
      return {
        color: rgbToHex(r, g, b),
        opacity: Math.round((a / 255) * 100) / 100,
        layerName: ref.name,
      };
    }
  }
  return null;
}

