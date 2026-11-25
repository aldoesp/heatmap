import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  createHeatmapRender,
  type HeatmapRenderInput,
} from '../src/lib/heatmapRender.js';
import {
  buildRssiMeshes,
  findUncoveredZones,
  type RssiPolygonConstraint,
} from '../src/lib/heatmapRssi.js';
import { buildRegularizedRssiField } from '../src/lib/regularizedRssi.js';
import { buildCoverageField } from '../src/lib/coverageField.js';
import { rasterizeRegularizedRssi } from '../src/lib/regularizedRaster.js';
import {
  chooseRasterSize,
  rasterizeRssiHybrid,
  rasterizeRssiMeshes,
} from '../src/lib/heatmapRaster.js';
import {
  buildColourLut,
  DEFAULT_HEATMAP_COLOURS,
} from '../src/lib/heatmapColours.js';
import { RSSI_BANDS } from '../src/lib/signal.js';
import type { HeatmapRow } from '../src/types/api.js';
import type { PlanReference } from '../src/lib/triangulation.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUTPUT_DIR = path.join(ROOT, 'benchmarks');

const PLAN: PlanReference = { id: 'bench-plan', width: 2400, height: 1600 };
const COLS = 10;
const ROWS = 8;
const BSSID_COUNT = 10;

function macAddress(index: number): string {
  return [
    0x02,
    (index >> 16) & 0xff,
    (index >> 8) & 0xff,
    index & 0xff,
    (index * 7) & 0xff,
    (index * 13) & 0xff,
  ]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join(':');
}

const BSSIDS = Array.from({ length: BSSID_COUNT }, (_, index) => macAddress(index + 1));
const ANCHORS = Array.from({ length: 4 }, (_, index) => ({
  bssid: BSSIDS[index % BSSIDS.length],
  x: 0.15 + index * 0.2,
  y: 0.2 + (index % 2) * 0.5,
}));

function buildMeasurements(): HeatmapRow[] {
  const rows: HeatmapRow[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const pointIndex = row * COLS + col;
      const x = (col + 0.5) / COLS;
      const y = (row + 0.5) / ROWS;
      for (let bssidIndex = 0; bssidIndex < BSSID_COUNT; bssidIndex += 1) {
        const anchor = ANCHORS[bssidIndex % ANCHORS.length];
        const dx = (x - anchor.x) * PLAN.width;
        const dy = (y - anchor.y) * PLAN.height;
        const distance = Math.hypot(dx, dy);
        const rssi = Math.max(-90, Math.min(-40, Math.round(-42 - 20 * Math.log10(1 + distance / 80))));
        const band24 = bssidIndex % 5 === 0;
        rows.push({
          scan_point_id: `p-${pointIndex}`,
          plan_id: PLAN.id,
          survey_id: 'survey-bench',
          x,
          y,
          bssid: BSSIDS[bssidIndex],
          bssid_name: `AP-${bssidIndex + 1}`,
          ssid: `SSID-${(bssidIndex % 5) + 1}`,
          band: band24 ? '2.4GHz' : '5GHz',
          frequency_mhz: band24 ? 2437 : 5180 + (bssidIndex % 8) * 20,
          rssi,
          quality: Math.max(0, Math.min(100, Math.round((rssi + 100) * 2))),
        });
      }
    }
  }
  return rows;
}

const measurements = buildMeasurements();
const polygons: RssiPolygonConstraint[] = [
  {
    id: 'zone-1',
    vertices: [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ],
  },
];
const apPositions = ANCHORS;
const accessPoints = ANCHORS.map((anchor, index) => ({
  id: `ap-${index}`,
  x: anchor.x,
  y: anchor.y,
  bssids: [anchor.bssid],
}));
const speedPoints = Array.from({ length: COLS * ROWS }, (_, index) => ({
  x: (index % COLS + 0.5) / COLS,
  y: (Math.floor(index / COLS) + 0.5) / ROWS,
  value: 40 + ((index * 37) % 460),
}));
const lut = buildColourLut(DEFAULT_HEATMAP_COLOURS);

const freeModel = buildRssiMeshes(measurements, PLAN);
const constrainedModel = buildRssiMeshes(measurements, PLAN, { polygons });
const regularizedField = buildRegularizedRssiField(
  measurements,
  PLAN,
  polygons,
  constrainedModel.meshes,
);
const hybridField = buildCoverageField(
  constrainedModel.meshes,
  polygons,
  apPositions,
  accessPoints,
);
const displaySize = chooseRasterSize(PLAN.width, PLAN.height, 512);
const exportSize = chooseRasterSize(PLAN.width, PLAN.height, 2048);

const baseInput: HeatmapRenderInput = {
  metric: 'rssi',
  calculation: 'regularized',
  plan: PLAN,
  measurements,
  points: [],
  polygons,
  apPositions,
  accessPoints,
  radius: 80,
  bands: RSSI_BANDS,
  lut,
  showEstimated: true,
};
const hybridInput: HeatmapRenderInput = { ...baseInput, calculation: 'hybrid' };
const exportInput: HeatmapRenderInput = { ...baseInput, maxRasterDimension: 2048 };
const speedInput: HeatmapRenderInput = {
  ...baseInput,
  metric: 'speed',
  points: speedPoints,
};

interface TimingStats {
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
  stddev: number;
  samples: number;
}

interface Stats extends TimingStats {
  coldMs: number;
  iterations: number;
  warmup: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function summarize(values: number[]): TimingStats {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number): number => {
    if (sorted.length === 0) return 0;
    const index = (sorted.length - 1) * q;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    min: round(sorted[0]),
    p50: round(quantile(0.5)),
    p95: round(quantile(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    stddev: round(Math.sqrt(variance)),
    samples: values.length,
  };
}

function bench(label: string, fn: () => unknown, iterations = 5, warmup = 1): Stats {
  process.stderr.write(`bench ${label} ... `);
  const coldStart = performance.now();
  fn();
  const coldMs = performance.now() - coldStart;
  for (let index = 0; index < warmup; index += 1) fn();
  const times: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  const stats = { ...summarize(times), coldMs: round(coldMs), iterations, warmup };
  process.stderr.write(`cold=${stats.coldMs}ms p50=${stats.p50}ms\n`);
  return stats;
}

function benchOnce<T>(label: string, fn: () => T): { stats: Stats; value: T } {
  process.stderr.write(`bench ${label} ... `);
  const start = performance.now();
  const value = fn();
  const ms = performance.now() - start;
  const stats = {
    ...summarize([ms]),
    coldMs: round(ms),
    iterations: 1,
    warmup: 0,
  };
  process.stderr.write(`cold=${stats.coldMs}ms p50=${stats.p50}ms\n`);
  return { stats, value };
}

const results: Record<string, Stats> = {
  'triangulate.free': bench('triangulate.free', () => buildRssiMeshes(measurements, PLAN), 5),
  'triangulate.polygons': bench(
    'triangulate.polygons',
    () => buildRssiMeshes(measurements, PLAN, { polygons }),
    5,
  ),
  'interpolate.regularized': bench(
    'interpolate.regularized',
    () => buildRegularizedRssiField(measurements, PLAN, polygons, constrainedModel.meshes),
    3,
  ),
  'interpolate.hybrid': bench(
    'interpolate.hybrid',
    () => buildCoverageField(constrainedModel.meshes, polygons, apPositions, accessPoints),
    5,
  ),
  'raster.regularized.512': bench(
    'raster.regularized.512',
    () =>
      rasterizeRegularizedRssi(
        regularizedField,
        PLAN.width,
        PLAN.height,
        displaySize.width,
        displaySize.height,
        lut,
        true,
      ),
    5,
  ),
  'raster.regularized.1024': benchOnce(
    'raster.regularized.1024',
    () =>
      rasterizeRegularizedRssi(
        regularizedField,
        PLAN.width,
        PLAN.height,
        chooseRasterSize(PLAN.width, PLAN.height, 1024).width,
        chooseRasterSize(PLAN.width, PLAN.height, 1024).height,
        lut,
        true,
      ),
  ).stats,
  'raster.hybrid.512': bench(
    'raster.hybrid.512',
    () =>
      rasterizeRssiHybrid(
        hybridField,
        () => true,
        PLAN.width,
        PLAN.height,
        displaySize.width,
        displaySize.height,
        lut,
        0.75,
        true,
      ),
    5,
  ),
  'raster.hybrid.1024': benchOnce(
    'raster.hybrid.1024',
    () =>
      rasterizeRssiHybrid(
        hybridField,
        () => true,
        PLAN.width,
        PLAN.height,
        chooseRasterSize(PLAN.width, PLAN.height, 1024).width,
        chooseRasterSize(PLAN.width, PLAN.height, 1024).height,
        lut,
        0.75,
        true,
      ),
  ).stats,
  'raster.meshes.512': bench(
    'raster.meshes.512',
    () =>
      rasterizeRssiMeshes(
        constrainedModel.meshes,
        PLAN.width,
        PLAN.height,
        displaySize.width,
        displaySize.height,
        lut,
        0.75,
      ),
    5,
  ),
  'full.regularized.512': bench('full.regularized.512', () => createHeatmapRender(baseInput), 3),
  'full.hybrid.512': bench('full.hybrid.512', () => createHeatmapRender(hybridInput), 3),
  'full.speed': bench('full.speed', () => createHeatmapRender(speedInput), 5),
  'uncoveredZones': bench(
    'uncoveredZones',
    () => findUncoveredZones(constrainedModel, polygons, PLAN),
    5,
  ),
};

const display = createHeatmapRender(baseInput);
const hybrid = createHeatmapRender(hybridInput);
const speed = createHeatmapRender(speedInput);
const exportedRun = benchOnce('full.regularized.export', () => createHeatmapRender(exportInput));
results['full.regularized.export'] = exportedRun.stats;
const exported = exportedRun.value;
const output = {
  phase: 0,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  methodology: {
    cold: 'premier appel de chaque étape, avant warmup',
    warmup: 'appels non mesurés avant les itérations (voir results[*].warmup)',
    iterations: 'appels mesurés (voir results[*].iterations)',
    export: 'export 2048 mesuré une seule fois, sans warmup',
    canvas: 'putImageData/toBlob hors périmètre Node',
  },
  scenario: {
    plan: PLAN,
    points: COLS * ROWS,
    bssids: BSSID_COUNT,
    measurements: measurements.length,
    polygons: polygons.length,
    displayRaster: displaySize,
    exportRaster: exportSize,
  },
  volumetry: {
    plan: PLAN,
    points: COLS * ROWS,
    bssids: BSSID_COUNT,
    measurements: measurements.length,
    polygons: polygons.length,
    displayRaster: displaySize,
    exportRaster: exportSize,
  },
  meshes: {
    free: freeModel.meshes.length,
    constrained: constrainedModel.meshes.length,
  },
  results,
  payloads: {
    displayBytes: display.image.data.byteLength,
    displayCoveredPixels: display.image.coveredPixels,
    exportBytes: exported.image.data.byteLength,
    exportCoveredPixels: exported.image.coveredPixels,
    hybridBytes: hybrid.image.data.byteLength,
    speedBytes: speed.image.data.byteLength,
  },
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const outputPath = path.join(OUTPUT_DIR, 'phase0-heatmap.json');
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log('Phase 0 heatmap');
console.log('Scenario', JSON.stringify(output.scenario));
console.log('Results (ms)');
console.table(
  Object.fromEntries(
    Object.entries(results).map(([name, stats]) => [
      name,
      {
        cold: stats.coldMs,
        p50: stats.p50,
        p95: stats.p95,
        max: stats.max,
        iterations: stats.iterations,
        warmup: stats.warmup,
      },
    ]),
  ),
);
console.log('Payloads', JSON.stringify(output.payloads));
console.log('Results written to', outputPath);
