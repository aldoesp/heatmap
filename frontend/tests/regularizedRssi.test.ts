import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitRegularizedRssi, buildRegularizedRssiField } from '../src/lib/regularizedRssi.js';
import { rasterizeRegularizedRssi, rssiContours } from '../src/lib/regularizedRaster.js';
import { buildColourLut, DEFAULT_HEATMAP_COLOURS, lutColourForRssi } from '../src/lib/heatmapColours.js';
import type { HeatmapRow } from '../src/types/api.js';
import type { HybridField } from '../src/lib/rssiHybridField.js';

const plan = { id: 'p', width: 100, height: 100 };
const row = (x: number, y: number, rssi: number, extra: Partial<HeatmapRow> = {}): HeatmapRow => ({
  scan_point_id: `${x}:${y}`, plan_id: 'p', survey_id: null, x, y, rssi,
  bssid: 'aa:bb:cc:dd:ee:01', bssid_name: 'AP', ssid: 'Test', band: '5GHz',
  frequency_mhz: 5180, quality: 60, ...extra,
});
const triangle = (value: number, extra: Partial<HeatmapRow> = {}) => [row(.1, .1, value, extra), row(.8, .1, value, extra), row(.1, .8, value, extra)];

describe('calcul RSSI régularisé', () => {
  it('reproduit le système thin_plate_spline de SciPy, smoothing=1', () => {
    const nodes = [[5, 10, -48], [80, 10, -72], [20, 90, -61], [70, 70, -80], [45, 40, -57]].map(([x, y, value]) => ({ x, y, value }));
    // Independent reference: scipy.interpolate.RBFInterpolator(nodes / 100,
    // values, kernel='thin_plate_spline', smoothing=1, degree=1).
    const predict = fitRegularizedRssi(nodes, 100);
    const expected = [[30, 25, -55.509286354007784], [55, 50, -67.77448811967852], [65, 75, -75.75197767974659]];
    for (const [x, y, value] of expected) assert.ok(Math.abs(predict(x, y)! - value) < 1e-7);
  });

  it('reste fini et borné pour des points colinéaires ou isolés', () => {
    const predict = fitRegularizedRssi([{ x: 0, y: 0, value: -50 }, { x: 10, y: 0, value: -80 }, { x: 20, y: 0, value: -60 }], 100);
    assert.equal(predict(0, 0), -50);
    assert.ok(predict(5, 7)! >= -80 && predict(5, 7)! <= -50);
    assert.equal(fitRegularizedRssi([{ x: 5, y: 5, value: -70 }], 100)(20, 20), -70);
    assert.equal(fitRegularizedRssi([], 100)(0, 0), null);
    assert.equal(predict(NaN, 0), null);
  });

  it('agrège les répétitions par médiane et écarte les lignes invalides', () => {
    const field = buildRegularizedRssiField([row(.2, .2, -50), row(.2, .2, -60), row(.2, .2, -90), row(.2, .2, 5), row(.2, .2, -20, { plan_id: 'other' })], plan);
    assert.equal(field.sample(20, 20).rssi, -60);
    assert.equal(field.sample(80, 80).status, 'NO_DATA');
    assert.equal(field.sample(NaN, 0).status, 'NO_DATA');
  });

  it('ajuste chaque radio, bande et relevé séparément avant de retenir le meilleur signal', () => {
    const rows = [...triangle(-80), ...triangle(-50, { bssid: 'aa:bb:cc:dd:ee:02' }), ...triangle(-60, { band: '2.4GHz', frequency_mhz: 2412 }), ...triangle(-40, { survey_id: 'other' })];
    const field = buildRegularizedRssiField(rows, plan);
    const sample = field.sample(20, 20);
    assert.equal(sample.status, 'INTERPOLATED');
    assert.ok(Math.abs(sample.rssi! + 40) < 1e-8);
    assert.equal(sample.source?.surveyId, 'other');
  });

  it('ne propage pas un signal entre deux zones ou dans une zone vide', () => {
    const polygons = [
      { id: 'left', vertices: [{ x: 0, y: 0 }, { x: .45, y: 0 }, { x: .45, y: 1 }, { x: 0, y: 1 }] },
      { id: 'right', vertices: [{ x: .55, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .55, y: 1 }] },
    ];
    const rows = [row(.1, .2, -50), row(.3, .2, -50), row(.1, .4, -50)];
    const field = buildRegularizedRssiField(rows, plan, polygons);
    assert.equal(field.sample(15, 25).status, 'INTERPOLATED');
    assert.equal(field.sample(70, 30).status, 'NO_DATA');
    assert.equal(field.sample(50, 30).status, 'NO_DATA');
    assert.equal(field.sample(40, 90).status, 'NO_DATA');
    const both = buildRegularizedRssiField([...rows, row(.6, .2, -90), row(.8, .2, -90), row(.6, .4, -90)], plan, polygons);
    assert.ok(Math.abs(both.sample(65, 25).rssi! + 90) < 1e-8);
  });
});

describe('rendu du champ régularisé', () => {
  it('place les isolignes sur le seuil et ne franchit pas les trous de données', () => {
    const contours = rssiContours(new Float32Array([-80, -60, -80, -60]), 2, 2, [-70]);
    assert.equal(contours.length, 1);
    assert.deepEqual(contours[0].a, [.5, 0]);
    assert.deepEqual(contours[0].b, [.5, 1]);
    assert.equal(rssiContours(new Float32Array([-80, NaN, -80, -60]), 2, 2, [-70]).length, 0);
  });

  it('respecte les trous, les couleurs et le masquage des extrapolations', () => {
    const field: HybridField = { model: null, sample: x => x > 50 ? { status: 'NO_DATA', rssi: null } : { status: x < 25 ? 'EXTRAPOLATED' : 'INTERPOLATED', rssi: -60, confidence: 1 } };
    const lut = buildColourLut(DEFAULT_HEATMAP_COLOURS);
    const shown = rasterizeRegularizedRssi(field, 100, 100, 5, 5, lut);
    const hidden = rasterizeRegularizedRssi(field, 100, 100, 5, 5, lut, false);
    assert.equal(shown.coveredPixels, 15);
    assert.equal(hidden.coveredPixels, 10);
    assert.deepEqual(Array.from(shown.data.slice(4, 8)), lutColourForRssi(lut, -60));
    assert.equal(shown.data[3 * 4 + 3], 0);
    assert.equal(hidden.data[3], 0);
    assert.ok(shown.data[0] >= lutColourForRssi(lut, -60)[0]);
  });
});
