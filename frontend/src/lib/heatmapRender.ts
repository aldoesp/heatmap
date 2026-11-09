import type { HeatmapRow } from '../types/api.js';
import type { PlanReference } from './triangulation.js';
import { buildRssiMeshes, findUncoveredZones, type RssiPolygonConstraint, type UncoveredZone } from './heatmapRssi.js';
import { buildRegularizedRssiField, type RssiCalculation } from './regularizedRssi.js';
import { buildCoverageField } from './coverageField.js';
import { rasterizeRegularizedRssi, type RssiContour } from './regularizedRaster.js';
import {
  chooseRasterSize,
  MAX_RASTER_DIMENSION,
  MAX_EXPORT_RASTER_DIMENSION,
  rasterizeRssiHybrid,
  rasterizeRssiMeshes,
  type RssiRaster,
} from './heatmapRaster.js';
import { buildZoneMask, pointInPolygonPx } from './polygon.js';
import type { HybridSample } from './rssiHybridField.js';

export interface CoveragePoint { x: number; y: number; value: number }
export interface CoverageBand { min: number; color: string }

export interface HeatmapRenderInput {
  metric: 'rssi' | 'speed';
  calculation: RssiCalculation;
  plan: PlanReference;
  measurements: HeatmapRow[];
  points: CoveragePoint[];
  polygons: RssiPolygonConstraint[];
  apPositions: readonly { bssid: string; x: number; y: number }[];
  accessPoints: readonly { id: string; x: number; y: number; bssids?: string[] }[];
  radius: number;
  bands: CoverageBand[];
  lut: Uint8ClampedArray;
  showEstimated: boolean;
  /** Limite du grand côté du raster ; 512 px par défaut, 2048 px pour l'export. */
  maxRasterDimension?: number;
}

export interface HeatmapMetadata { bssids: string[]; uncoveredZones: UncoveredZone[] }
export interface HeatmapImage extends RssiRaster { contours: RssiContour[] }
export interface HeatmapRenderResult {
  image: HeatmapImage;
  metadata: HeatmapMetadata;
  durationMs: number;
}

function rasterDimensionLimit(
  input: HeatmapRenderInput,
  fallback: number,
): number {
  const requested = input.maxRasterDimension;
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.min(
    Math.max(2, Math.floor(requested)),
    MAX_EXPORT_RASTER_DIMENSION,
  );
}

function zonePredicate(input: HeatmapRenderInput): (x: number, y: number) => boolean {
  const { plan, polygons } = input;
  if (!polygons.length) return () => true;
  const masks = polygons.flatMap(p => {
    const mask = buildZoneMask(p.vertices, plan.width, plan.height);
    return mask ? [mask] : [];
  });
  return (x, y) => masks.some(mask => x >= mask.minX && x <= mask.maxX && y >= mask.minY && y <= mask.maxY && pointInPolygonPx(x, y, mask.pixels));
}

/** Same banded IDW as the previous canvas renderer, now independent of the DOM. */
function rasterizeSpeed(input: HeatmapRenderInput): HeatmapImage {
  const { plan, points, radius, bands } = input;
  const { width, height } = chooseRasterSize(
    plan.width,
    plan.height,
    rasterDimensionLimit(input, 360),
  );
  const data = new Uint8ClampedArray(width * height * 4);
  const allowed = zonePredicate(input);
  const samples = points.map(p => ({ x: p.x * plan.width, y: (1 - p.y) * plan.height, value: p.value }));
  const palette = bands.map(b => ({ min: b.min, rgb: [1, 3, 5].map(i => parseInt(b.color.slice(i, i + 2), 16)) }));
  const smoothingDistance = Math.max(radius * .35, 1);
  const supportDistance = Math.max(radius * 3, Math.min(plan.width, plan.height) * .12);
  let coveredPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x / (width - 1) * plan.width, py = y / (height - 1) * plan.height;
    if (!allowed(px, plan.height - py)) continue;
    let sum = 0, weights = 0, nearestSquared = Infinity;
    for (const sample of samples) {
      const dx = px - sample.x, dy = py - sample.y, d2 = dx * dx + dy * dy;
      nearestSquared = Math.min(nearestSquared, d2);
      const weight = 1 / (d2 + smoothingDistance ** 2);
      sum += sample.value * weight; weights += weight;
    }
    if (!weights || nearestSquared > supportDistance ** 2) continue;
    const rgb = (palette.find(b => sum / weights >= b.min) ?? palette[palette.length - 1])?.rgb;
    if (!rgb) continue;
    const t = Math.sqrt(nearestSquared) / supportDistance;
    const fade = t < .7 ? 1 : 1 - (t - .7) / .3;
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = rgb[c];
    data[i + 3] = Math.round(Math.round(255 * .75) * fade);
    if (data[i + 3]) coveredPixels++;
  }
  return { width, height, data, coveredPixels, contours: [] };
}

/** Called in a worker. The raster and hover probe share the same fitted field. */
export function createHeatmapRender(input: HeatmapRenderInput): HeatmapRenderResult & { sample: (x: number, y: number) => HybridSample } {
  const start = performance.now();
  if (input.metric === 'speed') {
    return { image: rasterizeSpeed(input), metadata: { bssids: [], uncoveredZones: [] }, durationMs: performance.now() - start,
      sample: () => ({ status: 'NO_DATA', rssi: null }) };
  }
  const { plan, measurements, polygons, lut, showEstimated } = input;
  const model = buildRssiMeshes(measurements, plan, { polygons });
  const field = input.calculation === 'regularized'
    ? buildRegularizedRssiField(measurements, plan, polygons, model.meshes)
    : buildCoverageField(model.meshes, polygons, input.apPositions, input.accessPoints);
  const size = chooseRasterSize(
    plan.width,
    plan.height,
    rasterDimensionLimit(input, MAX_RASTER_DIMENSION),
  );
  let image: HeatmapImage;
  if (input.calculation === 'regularized') {
    image = rasterizeRegularizedRssi(field, plan.width, plan.height, size.width, size.height, lut, showEstimated);
  } else {
    const raster = polygons.length
      ? rasterizeRssiHybrid(field, zonePredicate(input), plan.width, plan.height, size.width, size.height, lut, .75, showEstimated)
      : rasterizeRssiMeshes(model.meshes, plan.width, plan.height, size.width, size.height, lut, .75);
    image = { ...(raster ?? { ...size, data: new Uint8ClampedArray(size.width * size.height * 4), coveredPixels: 0 }), contours: [] };
  }
  return { image, sample: field.sample, durationMs: performance.now() - start,
    metadata: { bssids: [...new Set(model.meshes.map(mesh => mesh.scope.bssid))], uncoveredZones: findUncoveredZones(model, polygons, plan) } };
}
