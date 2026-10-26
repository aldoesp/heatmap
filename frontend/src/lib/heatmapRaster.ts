import { imagePixelToPlanPixel, planPixelToImagePixel } from './coords.js';
import type { RssiBand } from './signal.js';
import {
  prepareBarycentricTriangle,
  rssiAtPreparedTriangle,
  type InterpolationMesh,
  type PreparedBarycentricTriangle,
} from './triangulation.js';

/** Résolution maximale de la texture, indépendante du zoom Leaflet. */
export const MAX_RASTER_DIMENSION = 512;

export interface RasterSize {
  width: number;
  height: number;
}

export interface RssiRaster {
  width: number;
  height: number;
  /** RGBA non prémultiplié, lignes du haut vers le bas. */
  data: Uint8ClampedArray<ArrayBuffer>;
  coveredPixels: number;
}

type ReadyTriangle = Extract<PreparedBarycentricTriangle, { status: 'READY' }>;

interface IndexedTriangle {
  prepared: ReadyTriangle;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Choisit la taille de la texture. Les petits plans gardent leur résolution
 * native ; les grands plans sont plafonnés à 512 px sur le plus grand côté.
 * La texture reste géoréférencée par ImageOverlay : zoom, déplacement,
 * redimensionnement et changement de plan ne nécessitent aucun recalcul.
 */
export function chooseRasterSize(
  planWidth: number,
  planHeight: number,
  maxDimension = MAX_RASTER_DIMENSION
): RasterSize {
  const scale = Math.min(1, maxDimension / Math.max(planWidth, planHeight));
  return {
    width: Math.max(2, Math.round(planWidth * scale)),
    height: Math.max(2, Math.round(planHeight * scale)),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function colorForValue(value: number, bands: Array<{ min: number; rgb: [number, number, number] }>): [number, number, number] | null {
  for (const band of bands) {
    if (value >= band.min) return band.rgb;
  }
  return null;
}

/**
 * Rasterise uniquement les pixels couverts par au moins un triangle.
 *
 * Chaque triangle n'est préparé qu'une fois, puis seuls les pixels de sa
 * boîte englobante sont testés : aucune recherche globale de triangle par
 * pixel. Si plusieurs maillages BSSID se chevauchent, on garde le RSSI le plus
 * fort, sans moyenner des réseaux différents. Les pixels hors triangles
 * restent à alpha 0.
 */
export function rasterizeRssiMeshes(
  meshes: InterpolationMesh[],
  planWidth: number,
  planHeight: number,
  imageWidth: number,
  imageHeight: number,
  bands: RssiBand[],
  opacity = 0.75
): RssiRaster | null {
  if (
    !(planWidth > 0) ||
    !(planHeight > 0) ||
    !(imageWidth >= 2) ||
    !(imageHeight >= 2)
  ) {
    return null;
  }

  const width = Math.round(imageWidth);
  const height = Math.round(imageHeight);
  const values = new Float64Array(width * height);
  values.fill(Number.NaN);
  const planXs = new Float64Array(width);
  const planYs = new Float64Array(height);
  for (let ix = 0; ix < width; ix += 1) {
    planXs[ix] = imagePixelToPlanPixel(ix, 0, planWidth, planHeight, width, height).xPx;
  }
  for (let iy = 0; iy < height; iy += 1) {
    planYs[iy] = imagePixelToPlanPixel(0, iy, planWidth, planHeight, width, height).yPx;
  }
  const rgbBands = bands.map((band) => ({ min: band.min, rgb: hexToRgb(band.color) }));

  const triangles: IndexedTriangle[] = [];
  for (const mesh of meshes) {
    for (const triangle of mesh.triangles) {
      const prepared = prepareBarycentricTriangle(triangle);
      if (prepared.status !== 'READY') continue;
      triangles.push({
        prepared,
        minX: Math.min(prepared.a.xPx, prepared.b.xPx, prepared.c.xPx),
        maxX: Math.max(prepared.a.xPx, prepared.b.xPx, prepared.c.xPx),
        minY: Math.min(prepared.a.yPx, prepared.b.yPx, prepared.c.yPx),
        maxY: Math.max(prepared.a.yPx, prepared.b.yPx, prepared.c.yPx),
      });
    }
  }

  for (const triangle of triangles) {
    const topLeft = planPixelToImagePixel(
      triangle.minX,
      triangle.maxY,
      planWidth,
      planHeight,
      width,
      height
    );
    const bottomRight = planPixelToImagePixel(
      triangle.maxX,
      triangle.minY,
      planWidth,
      planHeight,
      width,
      height
    );
    const minIx = clamp(Math.floor(topLeft.x), 0, width - 1);
    const maxIxRaw = clamp(Math.ceil(bottomRight.x), 0, width - 1);
    const minIy = clamp(Math.floor(topLeft.y), 0, height - 1);
    const maxIyRaw = clamp(Math.ceil(bottomRight.y), 0, height - 1);
    const maxIx = Math.max(minIx, maxIxRaw);
    const maxIy = Math.max(minIy, maxIyRaw);

    for (let iy = minIy; iy <= maxIy; iy += 1) {
      const planY = planYs[iy];
      for (let ix = minIx; ix <= maxIx; ix += 1) {
        const sample = rssiAtPreparedTriangle(planXs[ix], planY, triangle.prepared);
        if (sample === null) continue;

        const index = iy * width + ix;
        const previous = values[index];
        if (!Number.isFinite(previous) || sample > previous) {
          values[index] = sample;
        }
      }
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const maxAlpha = Math.round(255 * clamp(opacity, 0, 1));
  let coveredPixels = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;

    const rgb = colorForValue(value, rgbBands);
    if (rgb === null) continue;

    const offset = index * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = maxAlpha;
    coveredPixels += 1;
  }

  return { width, height, data, coveredPixels };
}
