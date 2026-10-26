import type { LatLng } from 'leaflet';

export interface NormalizedCoord {
  x: number;
  y: number;
}

export function latlngToData(
  latlng: LatLng,
  width: number,
  height: number
): NormalizedCoord {
  return {
    x: latlng.lng / width,
    y: latlng.lat / height,
  };
}

export function dataToLatLng(
  x: number,
  y: number,
  width: number,
  height: number
): [number, number] {
  return [y * height, x * width];
}

export function clampCoord({ x, y }: NormalizedCoord): NormalizedCoord {
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export interface PlanPixel {
  /** Abscisse continue dans le plan, en pixels, origine à gauche. */
  xPx: number;
  /** Ordonnée continue dans le plan, en pixels, origine en bas. */
  yPx: number;
}

export interface ImagePixel {
  /** Colonne de l'image raster, origine en haut à gauche. */
  x: number;
  /** Ligne de l'image raster, origine en haut à gauche. */
  y: number;
}

/** Convertit une coordonnée normalisée 0–1 en pixels du plan (y en bas). */
export function normalizedToPlanPixel(
  x: number,
  y: number,
  width: number,
  height: number
): PlanPixel {
  return { xPx: x * width, yPx: y * height };
}

/** Convertit des pixels du plan (y en bas) en coordonnée normalisée 0–1. */
export function planPixelToNormalized(
  xPx: number,
  yPx: number,
  width: number,
  height: number
): NormalizedCoord {
  return { x: xPx / width, y: yPx / height };
}

/**
 * Convertit un pixel du plan (origine en bas à gauche) en pixel d'une image
 * raster (origine en haut à gauche). Les bords du plan correspondent aux
 * bords de l'image, d'où les dénominateurs `largeur - 1` / `hauteur - 1`.
 */
export function planPixelToImagePixel(
  xPx: number,
  yPx: number,
  planWidth: number,
  planHeight: number,
  imageWidth: number,
  imageHeight: number
): ImagePixel {
  return {
    x: (xPx / planWidth) * Math.max(1, imageWidth - 1),
    y: (1 - yPx / planHeight) * Math.max(1, imageHeight - 1),
  };
}

/** Inverse de `planPixelToImagePixel`. */
export function imagePixelToPlanPixel(
  x: number,
  y: number,
  planWidth: number,
  planHeight: number,
  imageWidth: number,
  imageHeight: number
): PlanPixel {
  return {
    xPx: (x / Math.max(1, imageWidth - 1)) * planWidth,
    yPx: (1 - y / Math.max(1, imageHeight - 1)) * planHeight,
  };
}
