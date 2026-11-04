import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageField } from '../src/lib/coverageField.js';
import { buildRssiMeshes } from '../src/lib/heatmapRssi.js';
import { rasterizeRssiMeshes } from '../src/lib/heatmapRaster.js';
import { buildColourLut, DEFAULT_HEATMAP_COLOURS, lutColourForRssi } from '../src/lib/heatmapColours.js';
import type { HeatmapRow } from '../src/types/api.js';

const plan = { id: 'plan', width: 100, height: 100 };
const row = (id: string, x: number, y: number, rssi = -60): HeatmapRow => ({
  scan_point_id: id, plan_id: plan.id, survey_id: null, x, y, rssi,
  bssid: 'aa:bb:cc:dd:ee:01', bssid_name: 'AP', ssid: 'Test',
  band: '5GHz', frequency_mhz: 5180, quality: 60,
});
const zones = [
  { id: 'left', vertices: [{ x: 0, y: 0 }, { x: 0.45, y: 0 }, { x: 0.45, y: 1 }, { x: 0, y: 1 }] },
  { id: 'right', vertices: [{ x: 0.55, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.55, y: 1 }] },
];
const leftRows = [row('a', 0.1, 0.2), row('b', 0.3, 0.2), row('c', 0.1, 0.4)];

describe('champ partagé carte / sonde', () => {
  it('laisse une zone sans maillage transparente malgré le champ voisin', () => {
    const { meshes } = buildRssiMeshes(leftRows, plan, { polygons: zones });
    assert.equal(meshes.length, 1);
    const field = buildCoverageField(meshes, zones, [], []);
    assert.equal(field.sample(15, 25).status, 'INTERPOLATED');
    assert.equal(field.sample(40, 80).status, 'EXTRAPOLATED');
    assert.equal(field.sample(70, 30).status, 'NO_DATA');
    assert.equal(field.sample(50, 30).status, 'NO_DATA');
  });

  it('ne remplace pas les valeurs faibles d’une zone par l’extrapolation forte d’une autre', () => {
    const rows = [...leftRows, row('d', 0.6, 0.2, -90), row('e', 0.8, 0.2, -90), row('f', 0.6, 0.4, -90)];
    const { meshes } = buildRssiMeshes(rows, plan, { polygons: zones });
    const sample = buildCoverageField(meshes, zones, [], []).sample(65, 25);
    assert.equal(sample.status, 'INTERPOLATED');
    assert.equal(sample.rssi, -90);
  });

  it('sans zone, sonde et raster donnent la même couleur et restent limités aux triangles', () => {
    const { meshes } = buildRssiMeshes(leftRows, plan);
    const field = buildCoverageField(meshes, [], [{ bssid: leftRows[0].bssid, x: 0, y: 0 }], []);
    const lut = buildColourLut(DEFAULT_HEATMAP_COLOURS);
    const raster = rasterizeRssiMeshes(meshes, 100, 100, 101, 101, lut)!;
    const sample = field.sample(15, 25);
    assert.equal(sample.status, 'INTERPOLATED');
    const offset = (75 * 101 + 15) * 4;
    assert.deepEqual(Array.from(raster.data.slice(offset, offset + 4)), lutColourForRssi(lut, sample.rssi));
    assert.equal(field.sample(90, 90).status, 'NO_DATA');
  });
});
