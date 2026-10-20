import { describe, expect, it } from 'vitest';
import type { RadioParams } from '../types/wifi';
import { DEFAULT_COLOR_STOPS } from './defaults';
import {
  clampPoint,
  colorForDbm,
  computeHeatmapGrid,
  effectiveResolutionM,
  gridToRgba,
} from './wifiHeatmap';

const flatAntenna = {
  peakGainDbi: 0,
  azimuthDb: new Array(360).fill(0),
  elevationDb: new Array(360).fill(0),
};

const radio: RadioParams = {
  frequencyMHz: 5000,
  txPowerDbm: 20,
  antenna: flatAntenna,
  apRotationDeg: 0,
  apHeightM: 2,
  rxHeightM: 1.5,
  rxGainDbi: 0,
  model: 'fspl',
  pathLossExponent: 2,
  referenceDistanceM: 1,
  minDistanceM: 0.1,
};

const surface = { widthM: 10, heightM: 8 };
const center = { x: 5, y: 4 };

describe('computeHeatmapGrid', () => {
  it('10 x 8 m a 0,1 m -> 100 x 80 cellules', () => {
    const g = computeHeatmapGrid(surface, 0.1, center, radio);
    expect(g.cols).toBe(100);
    expect(g.rows).toBe(80);
    expect(g.powersDbm).toHaveLength(8000);
  });
  it('AP centre : les 4 coins sont symetriques', () => {
    const g = computeHeatmapGrid(surface, 0.5, center, radio);
    const p = g.powersDbm;
    const last = g.cols * g.rows - 1;
    expect(p[0]).toBeCloseTo(p[g.cols - 1], 4);
    expect(p[0]).toBeCloseTo(p[last], 4);
    expect(p[0]).toBeCloseTo(p[last - g.cols + 1], 4);
  });
  it('le signal diminue en s'eloignant de l'AP', () => {
    const g = computeHeatmapGrid(surface, 0.1, center, radio);
    const row = Math.floor(g.rows / 2) * g.cols;
    for (let c = Math.floor(g.cols / 2); c < g.cols - 1; c++) {
      expect(g.powersDbm[row + c + 1]).toBeLessThanOrEqual(g.powersDbm[row + c]);
    }
  });
  it('txPower +5 decale la grille de +5 dB', () => {
    const a = computeHeatmapGrid(surface, 0.5, center, radio);
    const b = computeHeatmapGrid(surface, 0.5, center, {
      ...radio,
      txPowerDbm: 25,
    });
    for (const i of [0, 100, 300, a.powersDbm.length - 1]) {
      expect(b.powersDbm[i] - a.powersDbm[i]).toBeCloseTo(5, 3);
    }
  });
  it('plafonne le nombre de cellules', () =>
    expect(
      effectiveResolutionM({ widthM: 50, heightM: 50 }, 0.05),
    ).toBeGreaterThanOrEqual(0.1 - 1e-9));

describe('clampPoint', () => {
  it('garde le point dans la surface', () => {
    expect(clampPoint({ x: -2, y: 99 }, surface)).toEqual({ x: 0, y: 8 });
    expect(clampPoint({ x: 3, y: 2 }, surface)).toEqual({ x: 3, y: 2 });
  });
});