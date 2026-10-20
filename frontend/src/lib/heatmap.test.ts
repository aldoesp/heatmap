import { describe, expect, it } from 'vitest';
import type { RadioParams } from '../types/wifi';
import { flatPattern } from './antennaPattern';
import { resolveAntenna } from './antennas';
import { DEFAULT_COLOR_STOPS } from './defaults';
import {
  clampPoint,
  colorForDbm,
  computeHeatmapGrid,
  effectiveResolutionM,
  gridToRgba,
} from './heatmap';

const radio: RadioParams = {
  frequencyMHz: 5000,
  txPowerDbm: 20,
  antennaId: 'isotropic',
  apRotationDeg: 0,
  apHeightM: 1,
  rxHeightM: 1,
  rxGainDbi: 0,
  model: 'fspl',
  pathLossExponent: 2,
  referenceDistanceM: 1,
  minDistanceM: 0.1,
};
const surface = { widthM: 10, heightM: 8 };
const center = { x: 5, y: 4 };
const iso = flatPattern(0);

describe('computeHeatmapGrid', () => {
  it('10 × 8 m à 0,1 m -> 100 × 80 cellules', () => {
    const g = computeHeatmapGrid(surface, 0.1, center, radio, iso);
    expect(g.cols).toBe(100);
    expect(g.rows).toBe(80);
    expect(g.powersDbm).toHaveLength(8000);
  });
  it('AP centré : les 4 coins sont symétriques', () => {
    const g = computeHeatmapGrid(surface, 0.5, center, radio, iso);
    const p = g.powersDbm;
    const last = g.cols * g.rows - 1;
    expect(p[0]).toBeCloseTo(p[g.cols - 1], 4);
    expect(p[0]).toBeCloseTo(p[last], 4);
    expect(p[0]).toBeCloseTo(p[last - g.cols + 1], 4);
  });
  it('le signal décroît en s\'éloignant de l\'AP', () => {
    const g = computeHeatmapGrid(surface, 0.1, center, radio, iso);
    const row = Math.floor(g.rows / 2) * g.cols;
    for (let c = Math.floor(g.cols / 2); c < g.cols - 1; c++) {
      expect(g.powersDbm[row + c + 1]).toBeLessThanOrEqual(g.powersDbm[row + c]);
    }
  });
  it('puissance d\'émission +5 dB décale toute la grille de +5 dB', () => {
    const a = computeHeatmapGrid(surface, 0.5, center, radio, iso);
    const b = computeHeatmapGrid(surface, 0.5, center, { ...radio, txPowerDbm: 25 }, iso);
    for (const i of [0, 100, 300, a.powersDbm.length - 1]) {
      expect(b.powersDbm[i] - a.powersDbm[i]).toBeCloseTo(5, 3);
    }
  });
  it('plafonne le nombre de cellules', () =>
    expect(
      effectiveResolutionM({ widthM: 50, heightM: 50 }, 0.05),
    ).toBeGreaterThanOrEqual(0.1 - 1e-9));
});

describe('antenne directionnelle (U7 Pro XGS)', () => {
  const real = { ...radio, antennaId: 'u7-pro-xgs' as const, apHeightM: 2.8, rxHeightM: 1 };
  const antenna = resolveAntenna('u7-pro-xgs', 5000);
  it('toutes les valeurs sont finies', () => {
    const g = computeHeatmapGrid(surface, 0.5, center, real, antenna);
    expect(g.powersDbm.every((v) => Number.isFinite(v))).toBe(true);
  });
  it('le diagramme déforme la carte par rapport à l\'isotrope', () => {
    const a = computeHeatmapGrid(surface, 0.5, center, real, flatPattern(antenna.peakGainDbi));
    const b = computeHeatmapGrid(surface, 0.5, center, real, antenna);
    let maxDiff = 0;
    for (let i = 0; i < a.powersDbm.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(a.powersDbm[i] - b.powersDbm[i]));
    }
    expect(maxDiff).toBeGreaterThan(1);
  });
  it('la rotation de l\'AP modifie la carte (azimut non uniforme)', () => {
    const a = computeHeatmapGrid(surface, 0.5, center, real, antenna);
    const b = computeHeatmapGrid(surface, 0.5, center, { ...real, apRotationDeg: 90 }, antenna);
    expect(b.powersDbm).not.toEqual(a.powersDbm);
  });
});

describe('colorForDbm', () => {
  const stops = DEFAULT_COLOR_STOPS;
  it('au-dessus du 1er seuil : couleur "excellent"', () =>
    expect(colorForDbm(stops[0].thresholdDbm + 10, stops)).toEqual(stops[0].rgb));
  it('sous le dernier seuil : couleur "très faible"', () =>
    expect(colorForDbm(stops[4].thresholdDbm - 30, stops)).toEqual(stops[4].rgb));
  it('mi-chemin : moyenne des deux ancres', () => {
    const mid = (stops[0].thresholdDbm + stops[1].thresholdDbm) / 2;
    const [r, g, b] = colorForDbm(mid, stops);
    expect(r).toBeCloseTo((stops[0].rgb[0] + stops[1].rgb[0]) / 2, 5);
    expect(g).toBeCloseTo((stops[0].rgb[1] + stops[1].rgb[1]) / 2, 5);
    expect(b).toBeCloseTo((stops[0].rgb[2] + stops[1].rgb[2]) / 2, 5);
  });
  it('gridToRgba : 4 octets par cellule, alpha opaque', () => {
    const g = computeHeatmapGrid(surface, 1, center, radio, iso);
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
