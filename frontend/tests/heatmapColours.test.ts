import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEATMAP_COLOURS,
  RSSI_MAX,
  RSSI_MIN,
  buildColourLut,
  lutColourForRssi,
  positionToRssi,
  rssiToPosition,
  sanitizeHeatmapColours,
  type HeatmapColours,
} from '../src/lib/heatmapColours.js';

describe('heatmapColours', () => {
  it('expose les constantes par défaut', () => {
    assert.deepEqual(DEFAULT_HEATMAP_COLOURS, {
      stops: [
        { position: 0, color: '#ef4444', opacity: 1 },
        { position: 0.25, color: '#f97316', opacity: 1 },
        { position: 0.42, color: '#f59e0b', opacity: 1 },
        { position: 0.55, color: '#a3e635', opacity: 1 },
        { position: 0.75, color: '#10b981', opacity: 1 },
      ],
      opacityStrongest: 0.75,
      opacityWeakest: 0.75,
    });
    assert.equal(RSSI_MIN, -100);
    assert.equal(RSSI_MAX, -40);
  });

  it('convertit RSSI en position et inversement', () => {
    assert.equal(rssiToPosition(RSSI_MIN), 0);
    assert.equal(rssiToPosition(RSSI_MAX), 1);
    assert.equal(rssiToPosition(-70), 0.5);
    assert.equal(rssiToPosition(-110), 0);
    assert.equal(rssiToPosition(-30), 1);

    assert.equal(positionToRssi(0), RSSI_MIN);
    assert.equal(positionToRssi(1), RSSI_MAX);
    assert.equal(positionToRssi(0.5), -70);
    assert.equal(positionToRssi(-1), RSSI_MIN);
    assert.equal(positionToRssi(2), RSSI_MAX);
  });

  it('sanitise les couleurs et applique les valeurs par défaut', () => {
    const def = sanitizeHeatmapColours(null);
    assert.deepEqual(def, {
      stops: [
        { position: 0, color: '#ef4444', opacity: 1 },
        { position: 0.25, color: '#f97316', opacity: 1 },
        { position: 0.42, color: '#f59e0b', opacity: 1 },
        { position: 0.55, color: '#a3e635', opacity: 1 },
        { position: 0.75, color: '#10b981', opacity: 1 },
      ],
      opacityStrongest: 0.75,
      opacityWeakest: 0.75,
    });

    const def2 = sanitizeHeatmapColours({});
    assert.equal(def2.stops.length, 5);

    const invalid = sanitizeHeatmapColours({ stops: [{ position: 0.5, color: 'bad' } as any] });
    assert.deepEqual(invalid.stops[0], DEFAULT_HEATMAP_COLOURS.stops[0]);
  });

  it('clamp les valeurs, trie par position, exige entre 2 et 12 stops', () => {
    const input: HeatmapColours = {
      stops: [
        { position: 1.5, color: '#00ff00', opacity: 2 },
        { position: -0.2, color: '#0000ff', opacity: -1 },
      ],
      opacityStrongest: 1.5,
      opacityWeakest: -2,
    };
    const res = sanitizeHeatmapColours(input);
    assert.equal(res.stops.length, 2);
    assert.equal(res.stops[0].position, 0);
    assert.equal(res.stops[1].position, 1);
    assert.equal(res.stops[0].opacity, 0);
    assert.equal(res.stops[1].opacity, 1);
    assert.equal(res.opacityStrongest, 1);
    assert.equal(res.opacityWeakest, 0);

    const sorted = sanitizeHeatmapColours({
      stops: [
        { position: 0.8, color: '#111111', opacity: 1 },
        { position: 0.1, color: '#222222', opacity: 1 },
        { position: 0.3, color: '#333333', opacity: 1 },
      ],
      opacityStrongest: 0.5,
      opacityWeakest: 0.5,
    });
    assert.deepEqual(sorted.stops.map((s) => s.position), [0.1, 0.3, 0.8]);

    const tooFew = sanitizeHeatmapColours({
      stops: [{ position: 0.5, color: '#ffffff', opacity: 1 }],
      opacityStrongest: 0.5,
      opacityWeakest: 0.5,
    });
    assert.equal(tooFew.stops.length, 5);

    const manyStops = [];
    for (let i = 0; i < 15; i += 1) {
      manyStops.push({ position: i / 14, color: '#000000', opacity: 1 });
    }
    const trimmed = sanitizeHeatmapColours({
      stops: manyStops,
      opacityStrongest: 0.5,
      opacityWeakest: 0.5,
    });
    assert.equal(trimmed.stops.length, 12);
  });

  it('construit une LUT de 256*4 avec interpolation RGB et opacité', () => {
    const lut = buildColourLut(DEFAULT_HEATMAP_COLOURS);
    assert.equal(lut.length, 256 * 4);
    // Check first pixel
    const c0 = lutColourForRssi(lut, RSSI_MIN);
    assert.equal(c0[0], 239); // #ef4444 ~ 239,68,68
    assert.equal(c0[1], 68);
    assert.equal(c0[2], 68);
    assert.equal(c0[3], Math.round(1 * 0.75 * 255));

    const c1 = lutColourForRssi(lut, RSSI_MAX);
    assert.equal(c1[0], 16); // #10b981 ~ 16,185,129
    assert.equal(c1[1], 185);
    assert.equal(c1[2], 129);
    assert.equal(c1[3], Math.round(1 * 0.75 * 255));
  });

  it('calcule correctement alpha avec strongest/weakest', () => {
    const colours: HeatmapColours = {
      stops: [
        { position: 0, color: '#ffffff', opacity: 1 },
        { position: 1, color: '#ffffff', opacity: 1 },
      ],
      opacityStrongest: 1,
      opacityWeakest: 0,
    };
    const lut = buildColourLut(colours);
    const low = lutColourForRssi(lut, RSSI_MIN); // p=0
    const high = lutColourForRssi(lut, RSSI_MAX); // p=1
    assert.equal(low[3], 0);
    assert.equal(high[3], 255);
  });
});
