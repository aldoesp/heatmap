import { describe, expect, it } from 'vitest';
import type { RadioParams } from '../types/wifi';
import { flatPattern } from './antennaPattern';
import {
  dbmToMilliwatts,
  fsplDb,
  ghzToMhz,
  linkGeometry,
  milliwattsToDbm,
  peakEirpDbm,
  receivedPowerDbm,
  receivedPowerFsplDbm,
  signalAt,
} from './radioPropagation';

/** AP et récepteur à la même hauteur : distance 3D = distance horizontale. */
const makeRadio = (o: Partial<RadioParams> = {}): RadioParams => ({
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
  ...o,
});

describe('conversions', () => {
  it('GHz -> MHz', () => expect(ghzToMhz(5)).toBe(5000));
  it('dBm <-> mW', () => {
    expect(dbmToMilliwatts(0)).toBeCloseTo(1, 9);
    expect(dbmToMilliwatts(20)).toBeCloseTo(100, 9);
    expect(milliwattsToDbm(1000)).toBeCloseTo(30, 9);
  });
});

describe('fsplDb (valeurs de référence)', () => {
  it('2,4 GHz à 1 m ≈ 40,04 dB', () => expect(fsplDb(1, 2400)).toBeCloseTo(40.044, 2));
  it('5 GHz à 1 m ≈ 46,42 dB', () => expect(fsplDb(1, 5000)).toBeCloseTo(46.419, 2));
  it('5 GHz à 100 m ≈ 86,42 dB', () => expect(fsplDb(100, 5000)).toBeCloseTo(86.419, 2));
  it('doubler la distance ajoute 6,02 dB', () =>
    expect(fsplDb(2, 5000) - fsplDb(1, 5000)).toBeCloseTo(6.0206, 3));
  it('5 GHz vs 2,4 GHz : +6,375 dB à distance constante', () =>
    expect(fsplDb(3, 5000) - fsplDb(3, 2400)).toBeCloseTo(6.375, 2));
  it('distance nulle : borne par la distance minimale', () => {
    const v = fsplDb(0, 5000, 0.1);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeCloseTo(fsplDb(0.1, 5000, 0.1), 9);
    expect(v).toBeCloseTo(26.419, 2);
  });
});

describe('bilan de liaison', () => {
  it('Ptx 20 dBm, gain 0 dBi, 5 GHz, 1 m -> -26,42 dBm', () =>
    expect(receivedPowerFsplDbm(1, makeRadio(), 0)).toBeCloseTo(-26.419, 2));
  it('le gain d\'émission est compté une seule fois', () => {
    // Ptx 14 dBm + 6 dBi == Ptx 20 dBm + 0 dBi
    expect(receivedPowerFsplDbm(3, makeRadio({ txPowerDbm: 14 }), 6)).toBeCloseTo(
      receivedPowerFsplDbm(3, makeRadio({ txPowerDbm: 20 }), 0),
      9,
    );
  });
  it('le gain de réception s\'ajoute 1 fois', () =>
    expect(receivedPowerFsplDbm(1, makeRadio({ rxGainDbi: 3 }), 0)).toBeCloseTo(-23.419, 2));
  it('décroît avec la distance', () => {
    const r = makeRadio();
    expect(receivedPowerDbm(2, r, 0)).toBeLessThan(receivedPowerDbm(1, r, 0));
    expect(receivedPowerDbm(8, r, 0)).toBeLessThan(receivedPowerDbm(2, r, 0));
  });
  it('puissance d\'émission +5 dB -> +5 dBm', () =>
    expect(
      receivedPowerDbm(4, makeRadio({ txPowerDbm: 25 }), 0) -
        receivedPowerDbm(4, makeRadio({ txPowerDbm: 20 }), 0),
    ).toBeCloseTo(5, 9));
  it('fréquence plus haute -> puissance plus faible', () =>
    expect(receivedPowerDbm(3, makeRadio({ frequencyMHz: 6000 }), 0)).toBeLessThan(
      receivedPowerDbm(3, makeRadio({ frequencyMHz: 2400 }), 0),
    ));
  it('EIRP de crête = Ptx + gain max', () =>
    expect(peakEirpDbm(makeRadio({ txPowerDbm: 14 }), flatPattern(6))).toBe(20));
});

describe('modèle log-distance', () => {
  const ld = (o: Partial<RadioParams> = {}) => makeRadio({ model: 'log-distance', ...o });
  it('n = 2 coïncide avec le FSPL', () => {
    for (const d of [0.5, 1, 3, 7.3]) {
      expect(receivedPowerDbm(d, ld(), 0)).toBeCloseTo(receivedPowerDbm(d, makeRadio(), 0), 6);
    }
  });
  it('n = 3, d0 = 1 m, d = 10 m -> Pr(d0) - 30 dB', () =>
    expect(receivedPowerDbm(10, ld({ pathLossExponent: 3 }), 0)).toBeCloseTo(-56.419, 2));
  it('un n plus grand atténue davantage au-delà de d0', () =>
    expect(receivedPowerDbm(8, ld({ pathLossExponent: 4 }), 0)).toBeLessThan(
      receivedPowerDbm(8, ld({ pathLossExponent: 2 }), 0),
    ));
});

describe('géométrie 3D', () => {
  it('droit sous l\'AP : nadir 0°, distance = différence de hauteur', () => {
    const g = linkGeometry(0, 0, makeRadio({ apHeightM: 2.8, rxHeightM: 1 }));
    expect(g.nadirDeg).toBeCloseTo(0, 9);
    expect(g.distanceM).toBeCloseTo(1.8, 9);
  });
  it('même hauteur : nadir 90° (horizon)', () =>
    expect(linkGeometry(3, 0, makeRadio()).nadirDeg).toBeCloseTo(90, 9));
  it('triangle 3-4 horizontal + 3 vertical -> distance 3D', () => {
    const g = linkGeometry(3, 4, makeRadio({ apHeightM: 4, rxHeightM: 1 }));
    expect(g.horizontalM).toBeCloseTo(5, 9);
    expect(g.distanceM).toBeCloseTo(Math.hypot(5, 3), 9);
  });
  it('rotation de l\'AP décale l\'azimut relatif', () => {
    expect(linkGeometry(1, 0, makeRadio({ apRotationDeg: 0 })).azimuthDeg).toBeCloseTo(0, 9);
    expect(linkGeometry(1, 0, makeRadio({ apRotationDeg: 90 })).azimuthDeg).toBeCloseTo(270, 9);
  });
});

describe('signalAt', () => {
  it('distance euclidienne 3-4-5 (antenne isotrope)', () => {
    const s = signalAt({ x: 3, y: 4 }, { x: 0, y: 0 }, makeRadio(), flatPattern(0));
    expect(s.distanceM).toBeCloseTo(5, 9);
    expect(s.txGainDbi).toBe(0);
    expect(s.powerDbm).toBeCloseTo(receivedPowerDbm(5, makeRadio(), 0), 9);
  });
});
