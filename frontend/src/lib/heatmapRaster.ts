import { imagePixelToPlanPixel, planPixelToImagePixel } from './coords.js';
import type { HybridField } from './rssiHybridField.js';
import type { RssiBand } from './signal.js';
import { lutColourForRssi } from './heatmapColours.js';
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

function isLut(palette: RssiBand[] | Uint8ClampedArray): palette is Uint8ClampedArray {
  return palette instanceof Uint8ClampedArray;
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
  palette: RssiBand[] | Uint8ClampedArray,
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
  const useLut = isLut(palette);
  const rgbBands = useLut ? [] : (palette as RssiBand[]).map((band) => ({ min: band.min, rgb: hexToRgb(band.color) }));

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
  const maxAlpha = useLut ? 0 : Math.round(255 * clamp(opacity, 0, 1));
  let coveredPixels = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;

    if (useLut) {
      const lut = palette as Uint8ClampedArray;
      const colour = lutColourForRssi(lut, value);
      const offset = index * 4;
      data[offset] = colour[0];
      data[offset + 1] = colour[1];
      data[offset + 2] = colour[2];
      data[offset + 3] = colour[3];
      if (colour[3] > 0) {
        coveredPixels += 1;
      }
    } else {
      const rgb = colorForValue(value, rgbBands);
      if (rgb === null) continue;

      const offset = index * 4;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = maxAlpha;
      coveredPixels += 1;
    }
  }

  return { width, height, data, coveredPixels };
}

/**
 * Rasterise le champ hybride (modèle de propagation + résidus interpolés)
 * uniquement à l'intérieur du masque fourni.
 *
 * Les pixels sont échantillonnés en leur centre (`x + 0.5`, `y + 0.5`) puis
 * convertis dans le repère du plan. Les valeurs extrapolées peuvent être
 * masquées via `showEstimated`, auquel cas leur alpha reste nul.
 */
export function rasterizeRssiHybrid(
  field: HybridField,
  zoneMask: (xPx: number, yPx: number) => boolean,
  planWidth: number,
  planHeight: number,
  imageWidth: number,
  imageHeight: number,
  palette: RssiBand[] | Uint8ClampedArray,
  opacity = 0.75,
  showEstimated = true
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
  const planXs = new Float64Array(width);
  const planYs = new Float64Array(height);
  for (let ix = 0; ix < width; ix += 1) {
    planXs[ix] = imagePixelToPlanPixel(
      ix + 0.5,
      0,
      planWidth,
      planHeight,
      width,
      height
    ).xPx;
  }
  for (let iy = 0; iy < height; iy += 1) {
    planYs[iy] = imagePixelToPlanPixel(
      0,
      iy + 0.5,
      planWidth,
      planHeight,
      width,
      height
    ).yPx;
  }

  const mask = new Uint8Array(width * height);
  let minIx = width;
  let maxIx = -1;
  let minIy = height;
  let maxIy = -1;

  for (let iy = 0; iy < height; iy += 1) {
    for (let ix = 0; ix < width; ix += 1) {
      if (!zoneMask(planXs[ix], planYs[iy])) continue;
      mask[iy * width + ix] = 1;
      if (ix < minIx) minIx = ix;
      if (ix > maxIx) maxIx = ix;
      if (iy < minIy) minIy = iy;
      if (iy > maxIy) maxIy = iy;
    }
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const useLut = isLut(palette);
  const rgbBands = useLut ? [] : (palette as RssiBand[]).map((band) => ({ min: band.min, rgb: hexToRgb(band.color) }));
  const maxAlpha = useLut ? 0 : Math.round(255 * clamp(opacity, 0, 1));
  let coveredPixels = 0;

  if (maxIx < minIx || maxIy < minIy) {
    return { width, height, data, coveredPixels };
  }

  for (let iy = minIy; iy <= maxIy; iy += 1) {
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      const index = iy * width + ix;
      if (mask[index] === 0) continue;

      const sample = field.sample(planXs[ix], planYs[iy]);
      if (sample.status === 'NO_DATA') continue;

      if (useLut) {
        const lut = palette as Uint8ClampedArray;
        const colour = lutColourForRssi(lut, sample.rssi);
        if (colour[3] === 0) continue;

        let alpha = colour[3];
        if (sample.status === 'INTERPOLATED') {
          // keep as is from LUT alpha? But LUT gives alpha from formula; also need to handle estimated
          // "dans l'hybride, multiplie l'alpha par 0.4+0.6*confidence pour les pixels ESTIMATED comme aujourd'hui"
          // LUT already includes alpha calculation; but requirement says "Si c'est une LUT, utilise lutColourForRssi (couleur et alpha viennent de la LUT, le param opacity est ignoré) ; dans l'hybride, multiplie l'alpha par 0.4+0.6*confidence pour les pixels ESTIMATED comme aujourd'hui."
          // So for LUT in hybrid, base alpha comes from LUT, but ESTIMATED pixels get multiplied by 0.4+0.6*confidence
        }

        if (sample.status === 'INTERPOLATED') {
          alpha = colour[3];
        } else {
          if (!showEstimated) continue;
          const confidence = clamp(sample.confidence, 0, 1);
          alpha = Math.round(colour[3] * (0.4 + 0.6 * confidence));
        }
        if (alpha <= 0) continue;

        const offset = index * 4;
        data[offset] = colour[0];
        data[offset + 1] = colour[1];
        data[offset + 2] = colour[2];
        data[offset + 3] = Math.max(0, Math.min(255, alpha));
        coveredPixels += 1;
      } else {
        let alpha: number;
        if (sample.status === 'INTERPOLATED') {
          alpha = maxAlpha;
        } else {
          if (!showEstimated) continue;
          const confidence = clamp(sample.confidence, 0, 1);
          alpha = Math.round(maxAlpha * (0.4 + 0.6 * confidence));
        }
        if (alpha <= 0) continue;

        const rgb = colorForValue(sample.rssi, rgbBands);
        if (rgb === null) continue;

        const offset = index * 4;
        data[offset] = rgb[0];
        data[offset + 1] = rgb[1];
        data[offset + 2] = rgb[2];
        data[offset + 3] = alpha;
        coveredPixels += 1;
      }
    }
  }

  return { width, height, data, coveredPixels };
}
