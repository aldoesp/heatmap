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

const radio: RadioParams = {
  frequencyMHz: 5000,
  eirpDbm: 20,
  rxGainDbi: 0,
  model: 'fspl',
  pathLossExponent: 2,
  referenceDistanceM: 1,
  minDistanceM: 0.1,
};
const surface = { widthM: 10, heightM: 8 };
const center = { x: 5, y: 4 };

describe('computeHeatmapGrid', () => {
  it('10 × 8 m à 0,1 m -> 100 × 80 cellules', () => {
    const g = computeHeatmapGrid(surface, 0.1, center, radio);
    expect(g.cols).toBe(100);
    expect(g.rows).toBe(80);
    expect(g.powersDbm).toHaveLength(8000);
  });
  it('AP centré : les 4 coins sont symétriques', () => {
    const g = computeHeatmapGrid(surface, 0.5, center, radio);
    const p = g.powersDbm;
    const last = g.cols * g.rows - 1;
    expect(p[0]).toBeCloseTo(p[g.cols - 1], 4);
    expect(p[0]).toBeCloseTo(p[last], 4);
    expect(p[0]).toBeCloseTo(p[last - g.cols + 1], 4);
  });
  it('le signal décroît en s\'éloignant de l\'AP', () => {
    const g = computeHeatmapGrid(surface, 0.1, center, radio);
    const row = Math.floor(g.rows / 2) * g.cols;
    for (let c = Math.floor(g.cols / 2); c < g.cols - 1; c++) {
      expect(g.powersDbm[row + c + 1]).toBeLessThanOrEqual(g.powersDbm[row + c]);
    }
  });
  it('EIRP +5 dB décale toute la grille de +5 dB', () => {
    const a = computeHeatmapGrid(surface, 0.5, center, radio);
    const b = computeHeatmapGrid(surface, 0.5, center, { ...radio, eirpDbm: 25 });
    for (const i of [0, 100, 300, a.powersDbm.length - 1]) {
      expect(b.powersDbm[i] - a.powersDbm[i]).toBeCloseTo(5, 3);
    }
  });
  it('plafonne le nombre de cellules', () =>
    expect(
      effectiveResolutionM({ widthM: 50, heightM: 50 }, 0.05),
    ).toBeGreaterThanOrEqual(0.1 - 1e-9));
});

describe('colorForDbm', () => {
  const stops = DEFAULT_COLOR_STOPS;
  it('au-dessus du 1er seuil : couleur "excellent"', () =>
    expect(colorForDbm(-10, stops)).toEqual(stops[0].rgb));
  it('sous le dernier seuil : couleur "très faible"', () =>
    expect(colorForDbm(-100, stops)).toEqual(stops[4].rgb));
  it('mi-chemin : moyenne des deux ancres', () => {
    const [r, g, b] = colorForDbm(-32.5, stops);
    expect(r).toBeCloseTo((stops[0].rgb[0] + stops[1].rgb[0]) / 2, 5);
    expect(g).toBeCloseTo((stops[0].rgb[1] + stops[1].rgb[1]) / 2, 5);
    expect(b).toBeCloseTo((stops[0].rgb[2] + stops[1].rgb[2]) / 2, 5);
  });
  it('gridToRgba : 4 octets par cellule, alpha opaque', () => {
    const g = computeHeatmapGrid(surface, 1, center, radio);
    const rgba = gridToRgba(g, stops);
    expect(rgba).toHaveLength(g.cols * g.rows * 4);
    expect(rgba[3]).toBe(255);
  });
});

describe('clampPoint', () => {
  it('garde le point dans la surface', () => {
    expect(clampPoint({ x: -2, y: 99 }, surface)).toEqual({ x: 0, y: 8 });
    expect(clampPoint({ x: 3, y: 2 }, surface)).toEqual({ x: 3, y: 2 });
  });
});
