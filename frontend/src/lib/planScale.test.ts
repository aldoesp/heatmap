import { describe, expect, it } from 'vitest';
import {
  computeMetersPerPixel,
  displayPxToPlanPx,
  isValidCalibrationDistanceM,
  isValidMetersPerPixel,
  metersToNormalizedPoint,
  metersToPlanPixels,
  normalizedDistanceM,
  normalizedToMetersPoint,
  planPixelsToMeters,
  simulationSurfaceOf,
} from './planScale';
import { computeHeatmapGrid } from './heatmap';
import { resolveAntenna } from './antennas';
import { signalAt } from './radioPropagation';
import type { RadioParams, Surface } from '../types/wifi';

const SURFACE: Surface = { widthM: 20, heightM: 12 };
const CALIBRATED = { width: 2000, height: 1200, metersPerPixel: 0.01 };

/** Radio par défaut de la simulation sur plan (idem createDefaultConfig). */
const RADIO: RadioParams = {
  frequencyMHz: 5000,
  txPowerDbm: 14,
  antennaId: 'u7-pro-xgs',
  apRotationDeg: 0,
  apHeightM: 2.8,
  rxHeightM: 1,
  rxGainDbi: 0,
  model: 'fspl',
  pathLossExponent: 2,
  referenceDistanceM: 1,
  minDistanceM: 0.1,
};

describe('calibration (metersPerPixel)', () => {
  it('valide les échelles dans les bornes', () => {
    expect(isValidMetersPerPixel(0.01)).toBe(true);
    expect(isValidMetersPerPixel(0.0005)).toBe(true);
    expect(isValidMetersPerPixel(10)).toBe(true);
  });

  it('rejette les échelles invalides, nulles ou aberrantes', () => {
    expect(isValidMetersPerPixel(0)).toBe(false);
    expect(isValidMetersPerPixel(-0.01)).toBe(false);
    expect(isValidMetersPerPixel(100)).toBe(false);
    expect(isValidMetersPerPixel(NaN)).toBe(false);
    expect(isValidMetersPerPixel(Infinity)).toBe(false);
    expect(isValidMetersPerPixel('0.01' as unknown as number)).toBe(false);
    expect(isValidMetersPerPixel(null as unknown as number)).toBe(false);
  });

  it('calcule l\'échelle depuis deux points et une distance', () => {
    // 100 px = 1 m -> 0,01 m/px
    expect(computeMetersPerPixel(0, 0, 100, 0, 1)).toBeCloseTo(0.01, 10);
    expect(computeMetersPerPixel(10, 10, 110, 10, 1)).toBeCloseTo(0.01, 10);
  });

  it('rejette les points confondus, trop proches ou distance invalide', () => {
    expect(computeMetersPerPixel(50, 50, 50, 50, 1)).toBeNull();
    expect(computeMetersPerPixel(50, 50, 52, 50, 1)).toBeNull(); // bruit < 5 px
    expect(computeMetersPerPixel(0, 0, 100, 0, 0)).toBeNull();
    expect(computeMetersPerPixel(0, 0, 100, 0, -3)).toBeNull();
    expect(computeMetersPerPixel(0, 0, 100, 0, 1e6)).toBeNull();
    expect(computeMetersPerPixel(NaN, 0, 100, 0, 1)).toBeNull();
    // Résultat hors bornes : 0,1 m sur 100 px = 0,001 sans excès, OK ;
    // en revanche 0,001 m/px inférieur à la borne basse est refusé.
    expect(computeMetersPerPixel(0, 0, 1000, 0, 0.0001)).toBeNull();
  });

  it('valide les distances de calibration', () => {
    expect(isValidCalibrationDistanceM(0.1)).toBe(true);
    expect(isValidCalibrationDistanceM(1000)).toBe(true);
    expect(isValidCalibrationDistanceM(0.01)).toBe(false);
    expect(isValidCalibrationDistanceM(2000)).toBe(false);
    expect(isValidCalibrationDistanceM(NaN)).toBe(false);
  });
});

describe('conversions de coordonnées', () => {
  it('convertit les pixels de plan en mètres RF', () => {
    const p = planPixelsToMeters(1500, 600, CALIBRATED);
    expect(p.x).toBeCloseTo(15, 10);
    expect(p.y).toBeCloseTo(6, 10);
    const back = metersToPlanPixels(p, CALIBRATED);
    expect(back.x).toBeCloseTo(1500, 6);
    expect(back.y).toBeCloseTo(600, 6);
  });

  it('convertit normalisé -> mètres avec l\'axe Y inversé', () => {
    const bottomLeft = normalizedToMetersPoint(0, 0, SURFACE);
    const topRight = normalizedToMetersPoint(1, 1, SURFACE);
    expect(bottomLeft).toEqual({ x: 0, y: 12 }); // y=0 en bas -> bas de la grille RF
    expect(topRight).toEqual({ x: 20, y: 0 }); // y=1 en haut -> y=0 RF
  });

  it('convertit mètres -> normalisé et conserve la position (aller-retour)', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 20, y: 12 },
      { x: 7.3, y: 4.6 },
    ]) {
      const n = metersToNormalizedPoint(p, SURFACE);
      const back = normalizedToMetersPoint(n.x, n.y, SURFACE);
      expect(back.x).toBeCloseTo(p.x, 10);
      expect(back.y).toBeCloseTo(p.y, 10);
    }
  });

  it('conserve les positions via pixels -> mètres RF -> normalisé -> pixels', () => {
    // Chaîne complète : clic sur l'image -> grille RF -> API -> retour écran
    for (const [px, py] of [
      [0, 0],
      [2000, 1200],
      [1701, 213],
    ] as const) {
      const meters = planPixelsToMeters(px, py, CALIBRATED);
      const normalized = metersToNormalizedPoint(meters, {
        widthM: 20,
        heightM: 12,
      });
      expect(normalized.x).toBeCloseTo(px / 2000, 6);
      // y image (haut) = 1 - y normalisé (bas)
      expect(normalized.y).toBeCloseTo(1 - py / 1200, 6);
    }
  });

  it('calcule la distance métrique entre deux positions normalisées', () => {
    const d = normalizedDistanceM({ x: 0, y: 0 }, { x: 1, y: 0 }, SURFACE);
    expect(d).toBeCloseTo(20, 10);
    const d2 = normalizedDistanceM({ x: 0, y: 0.5 }, { x: 0, y: 1 }, SURFACE);
    expect(d2).toBeCloseTo(6, 10);
  });

  it('convertit les pixels d\'affichage en pixels d\'image', () => {
    // Image de 2000 px affichée sur 500 px CSS
    expect(displayPxToPlanPx(250, 500, 2000)).toBeCloseTo(1000, 6);
    expect(displayPxToPlanPx(0, 500, 2000)).toBe(0);
  });
});

describe('surface de simulation', () => {
  it('déduit la surface métrique du plan calibré', () => {
    expect(simulationSurfaceOf(CALIBRATED)).toEqual({ widthM: 20, heightM: 12 });
  });

  it('rejette plan non calibré ou image invalide', () => {
    expect(simulationSurfaceOf(null)).toBeNull();
    expect(simulationSurfaceOf({ width: 2000, height: 1200, metersPerPixel: null })).toBeNull();
    expect(simulationSurfaceOf({ width: 2000, height: 1200, metersPerPixel: 0 })).toBeNull();
    expect(simulationSurfaceOf({ width: 2000, height: 1200, metersPerPixel: 9999 })).toBeNull();
    expect(simulationSurfaceOf({ width: 0, height: 1200, metersPerPixel: 0.01 })).toBeNull();
  });
});

describe('cohérence position déplacée <-> grille (reproductibilité)', () => {
  const surface: Surface = { widthM: 20, heightM: 12 };

  it('place le pic RSSI dans la cellule de l\'AP déplacé (isotropique)', () => {
    const iso: RadioParams = { ...RADIO, antennaId: 'isotropic' };
    const antenna = resolveAntenna('isotropic', 5000);
    for (const normalized of [
      { x: 0.3, y: 0.2 },
      { x: 0.7, y: 0.5 },
      { x: 0.5, y: 0.8 },
    ]) {
      const ap = normalizedToMetersPoint(normalized.x, normalized.y, surface);
      const grid = computeHeatmapGrid(surface, 0.25, ap, iso, antenna);
      let bestIdx = 0;
      for (let i = 1; i < grid.powersDbm.length; i++) {
        if (grid.powersDbm[i] > grid.powersDbm[bestIdx]) bestIdx = i;
      }
      const bestRow = Math.floor(bestIdx / grid.cols);
      const bestCol = bestIdx % grid.cols;
      const cellCenterY = (bestRow + 0.5) * grid.cellHeightM;
      const cellCenterX = (bestCol + 0.5) * grid.cellWidthM;
      // Pour une antenne isotropique, la puissance décroît avec la distance :
      // la meilleure cellule est nécessairement adjacente à celle de l'AP.
      expect(Math.abs(cellCenterX - ap.x)).toBeLessThan(grid.cellWidthM + 1e-6);
      expect(Math.abs(cellCenterY - ap.y)).toBeLessThan(grid.cellHeightM + 1e-6);
      // La sonde posée sur l'AP reste au niveau maximal (distance plancher).
      const atAp = signalAt(ap, ap, iso, antenna);
      expect(atAp.powerDbm).toBeCloseTo(grid.powersDbm[bestIdx], 0);
    }
  });

  it('change la grille quand l\'AP se déplace (même radio)', () => {
    const antenna = resolveAntenna(RADIO.antennaId, RADIO.frequencyMHz);
    const g1 = computeHeatmapGrid(
      surface,
      0.25,
      normalizedToMetersPoint(0.2, 0.3, surface),
      RADIO,
      antenna,
    );
    const g2 = computeHeatmapGrid(
      surface,
      0.25,
      normalizedToMetersPoint(0.8, 0.3, surface),
      RADIO,
      antenna,
    );
    expect(Array.from(g1.powersDbm)).not.toEqual(Array.from(g2.powersDbm));
  });
});

describe('performance du recalcul (grille représentative)', () => {
  it('recalcule une grille 0,25 m sur plan 20×12 m en moins de 30 ms', () => {
    const surface: Surface = { widthM: 20, heightM: 12 };
    const ap = { x: 10, y: 6 };
    const antenna = resolveAntenna('u7-pro-xgs', 5000);

    // Échauffement JIT
    computeHeatmapGrid(surface, 0.25, ap, RADIO, antenna);

    const runs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      computeHeatmapGrid(surface, 0.25, ap, RADIO, antenna);
      runs.push(performance.now() - t0);
    }
    const median = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];

    // ~4 000 cellules par recalcul : doit rester bien en dessous d'une frame.
    expect(median).toBeLessThan(30);
    // Journal conservé pour le rapport
    // (moyenne mobile pendant le développement : voir audit-rapport.md)
  });
});
