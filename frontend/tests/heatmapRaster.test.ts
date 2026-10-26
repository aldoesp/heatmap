import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { imagePixelToPlanPixel } from '../src/lib/coords.js';
import { buildRssiMeshes } from '../src/lib/heatmapRssi.js';
import {
  chooseRasterSize,
  rasterizeRssiMeshes,
} from '../src/lib/heatmapRaster.js';
import { RSSI_BANDS } from '../src/lib/signal.js';
import { sampleTriangleMesh } from '../src/lib/triangulation.js';
import type { HeatmapRow } from '../src/types/api.js';

const PLAN = { id: 'plan-a', width: 100, height: 100 };

function row(
  scanPointId: string,
  x: number,
  y: number,
  rssi: number,
  overrides: Partial<HeatmapRow> = {}
): HeatmapRow {
  return {
    scan_point_id: scanPointId,
    plan_id: 'plan-a',
    survey_id: null,
    x,
    y,
    bssid: 'aa:bb:cc:dd:ee:01',
    bssid_name: 'AP test',
    ssid: 'Test',
    band: '2.4GHz',
    frequency_mhz: 2412,
    rssi,
    quality: 50,
    ...overrides,
  };
}

const ROWS = [
  row('a', 0.1, 0.1, -50),
  row('b', 0.9, 0.1, -60),
  row('c', 0.1, 0.9, -70),
];

function pixelOffset(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

describe('rasterisation de la heatmap RSSI', () => {
  it('plafonne la résolution des grands plans et garde les petits plans', () => {
    assert.deepEqual(chooseRasterSize(100, 80), { width: 100, height: 80 });
    assert.deepEqual(chooseRasterSize(4000, 2000), { width: 512, height: 256 });
  });

  it('colore uniquement l’intérieur des triangles et laisse le reste transparent', () => {
    const model = buildRssiMeshes(ROWS, PLAN);
    assert.equal(model.status, 'READY');

    const raster = rasterizeRssiMeshes(model.meshes, 100, 100, 21, 21, RSSI_BANDS, 0.75);
    assert.ok(raster);
    assert.ok(raster.coveredPixels > 0);
    assert.ok(raster.coveredPixels < raster.width * raster.height);

    const inside = pixelOffset(4, 16, 21);
    assert.ok(raster.data[inside + 3] > 0);
    assert.deepEqual(
      [raster.data[inside], raster.data[inside + 1], raster.data[inside + 2]],
      [16, 185, 129]
    );

    const outside = pixelOffset(18, 2, 21);
    assert.equal(raster.data[outside + 3], 0);
  });

  it('ne colorise aucun pixel situé hors de la triangulation', () => {
    const model = buildRssiMeshes(ROWS, PLAN);
    assert.equal(model.status, 'READY');
    const raster = rasterizeRssiMeshes(model.meshes, 100, 100, 21, 21, RSSI_BANDS);
    assert.ok(raster);

    for (let iy = 0; iy < raster.height; iy += 1) {
      for (let ix = 0; ix < raster.width; ix += 1) {
        if (raster.data[pixelOffset(ix, iy, raster.width) + 3] === 0) continue;
        const plan = imagePixelToPlanPixel(ix, iy, 100, 100, raster.width, raster.height);
        const sample = sampleTriangleMesh(model.meshes[0], plan.xPx, plan.yPx);
        assert.notEqual(sample.status, 'OUTSIDE');
      }
    }
  });

  it('ne colorise rien sans maillage exploitable', () => {
    const raster = rasterizeRssiMeshes([], 100, 100, 21, 21, RSSI_BANDS);
    assert.ok(raster);
    assert.equal(raster.coveredPixels, 0);
    assert.ok(raster.data.every((channel) => channel === 0));
  });

  it('garde le meilleur RSSI quand deux maillages BSSID se chevauchent', () => {
    const weakRows = ROWS.map((entry) => ({
      ...entry,
      bssid: 'aa:bb:cc:dd:ee:02',
      rssi: -70,
    }));
    const model = buildRssiMeshes([...ROWS, ...weakRows], PLAN);
    assert.equal(model.meshes.length, 2);

    const raster = rasterizeRssiMeshes(model.meshes, 100, 100, 21, 21, RSSI_BANDS);
    assert.ok(raster);
    const inside = pixelOffset(4, 16, 21);
    assert.deepEqual(
      [raster.data[inside], raster.data[inside + 1], raster.data[inside + 2]],
      [16, 185, 129]
    );
  });

  it('rejette des dimensions de raster invalides', () => {
    assert.equal(rasterizeRssiMeshes([], 0, 100, 21, 21, RSSI_BANDS), null);
    assert.equal(rasterizeRssiMeshes([], 100, 100, 1, 21, RSSI_BANDS), null);
  });
});
