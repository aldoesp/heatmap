import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { imagePixelToPlanPixel } from '../src/lib/coords.js';
import { buildRssiMeshes } from '../src/lib/heatmapRssi.js';
import {
  chooseRasterSize,
  rasterizeRssiHybrid,
  rasterizeRssiMeshes,
} from '../src/lib/heatmapRaster.js';
import { createHybridField } from '../src/lib/rssiHybridField.js';
import { RSSI_BANDS } from '../src/lib/signal.js';
import { sampleTriangleMesh, triangulateRssi } from '../src/lib/triangulation.js';
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

describe('rasterisation hybride RSSI', () => {
  it('distingue interpolé, extrapolé et hors masque', () => {
    const points: Array<{ x: number; y: number; rssi: number }> = [];
    for (let iy = 0; iy < 3; iy += 1) {
      for (let ix = 0; ix < 3; ix += 1) {
        points.push({
          x: 10.5 + ix * 20,
          y: 10.5 + iy * 20,
          rssi: -50 - (ix + iy) * 5,
        });
      }
    }

    const result = triangulateRssi({
      scope: {
        planId: PLAN.id,
        surveyId: null,
        bssid: 'aa:bb:cc:dd:ee:01',
        frequency_mhz: null,
        band: '2.4GHz',
      },
      plan: PLAN,
      measurements: points.map((point, index) => ({
        scan_point_id: `p${index}`,
        planId: PLAN.id,
        surveyId: null,
        bssid: 'aa:bb:cc:dd:ee:01',
        frequency_mhz: null,
        band: '2.4GHz',
        x: point.x / PLAN.width,
        y: point.y / PLAN.height,
        rssi: point.rssi,
      })),
    });
    assert.equal(result.status, 'READY');
    if (result.status !== 'READY') return;

    const field = createHybridField(result.mesh, {
      ap: { xPx: 0, yPx: 0 },
    });
    const zoneMask = (xPx: number, yPx: number) =>
      xPx >= 0 && xPx <= 80 && yPx >= 0 && yPx <= 80;

    const raster = rasterizeRssiHybrid(
      field,
      zoneMask,
      100,
      100,
      101,
      101,
      RSSI_BANDS,
      0.8
    );
    assert.ok(raster);

    const measuredOffset = pixelOffset(10, 89, 101);
    const interpolatedOffset = pixelOffset(20, 79, 101);
    const farOffset = pixelOffset(75, 24, 101);
    const outsideOffset = pixelOffset(90, 10, 101);

    assert.equal(field.sample(75.5, 75.5).status, 'EXTRAPOLATED');

    const interpolatedAlpha = raster.data[interpolatedOffset + 3];
    const farAlpha = raster.data[farOffset + 3];
    assert.equal(interpolatedAlpha, Math.round(255 * 0.8));
    assert.ok(farAlpha > 0);
    assert.ok(farAlpha < interpolatedAlpha);

    const band = RSSI_BANDS.find((entry) => -50 >= entry.min);
    assert.ok(band);
    const expectedRgb = [
      parseInt(band.color.slice(1, 3), 16),
      parseInt(band.color.slice(3, 5), 16),
      parseInt(band.color.slice(5, 7), 16),
    ];
    assert.deepEqual(
      [
        raster.data[measuredOffset],
        raster.data[measuredOffset + 1],
        raster.data[measuredOffset + 2],
      ],
      expectedRgb
    );

    assert.equal(raster.data[outsideOffset + 3], 0);

    const withoutEstimated = rasterizeRssiHybrid(
      field,
      zoneMask,
      100,
      100,
      101,
      101,
      RSSI_BANDS,
      0.8,
      false
    );
    assert.ok(withoutEstimated);
    assert.equal(withoutEstimated.data[farOffset + 3], 0);
  });
});
