import { describe, expect, it } from 'vitest';
import type { RadioParams } from '../types/wifi';
import {
  dbmToMilliwatts,
  fsplDb,
  ghzToMhz,
  milliwattsToDbm,
  receivedPowerDbm,
  receivedPowerFsplDbm,
  signalAt,
} from './radioPropagation';

const makeRadio = (o: Partial<RadioParams> = {}): RadioParams => ({
  frequencyMHz: 5000,
  eirpDbm: 20,
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
  it('2,4 GHz à 1 m ≈ 40,04 dB', () =>
    expect(fsplDb(1, 2400)).toBeCloseTo(40.044, 2));
  it('5 GHz à 1 m ≈ 46,42 dB', () =>
    expect(fsplDb(1, 5000)).toBeCloseTo(46.419, 2));
  it('5 GHz à 100 m ≈ 86,42 dB', () =>
    expect(fsplDb(100, 5000)).toBeCloseTo(86.419, 2));
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

describe('puissance reçue', () => {
  it('FSPL : 20 dBm EIRP, 5 GHz, 1 m, 0 dBi -> -26,42 dBm', () =>
    expect(receivedPowerFsplDbm(1, makeRadio())).toBeCloseTo(-26.419, 2));
  it('le gain de réception s\'ajoute 1 fois', () =>
    expect(receivedPowerFsplDbm(1, makeRadio({ rxGainDbi: 3 }))).toBeCloseTo(
      -23.419,
      2,
    ));
  it('décroît avec la distance', () => {
    const r = makeRadio();
    expect(receivedPowerDbm(2, r)).toBeLessThan(receivedPowerDbm(1, r));
    expect(receivedPowerDbm(8, r)).toBeLessThan(receivedPowerDbm(2, r));
  });
  it('EIRP +5 dB -> +5 dBm', () => {
    const d = 4;
    expect(
      receivedPowerDbm(d, makeRadio({ eirpDbm: 25 })) -
        receivedPowerDbm(d, makeRadio({ eirpDbm: 20 })),
    ).toBeCloseTo(5, 9);
  });
  it('fréquence plus haute -> puissance plus faible', () =>
    expect(receivedPowerDbm(3, makeRadio({ frequencyMHz: 6000 }))).toBeLessThan(
      receivedPowerDbm(3, makeRadio({ frequencyMHz: 2400 })),
    ));
});

describe('modèle log-distance', () => {
  it('n = 2 coïncide avec le FSPL', () => {
    for (const d of [0.5, 1, 3, 7.3]) {
      expect(
        receivedPowerDbm(d, makeRadio({ model: 'log-distance', pathLossExponent: 2 })),
      ).toBeCloseTo(receivedPowerDbm(d, makeRadio()), 6);
    }
  });
  it('n = 3, d0 = 1 m, d = 10 m -> Pr(d0) - 30 dB', () =>
    expect(
      receivedPowerDbm(10, makeRadio({ model: 'log-distance', pathLossExponent: 3 })),
    ).toBeCloseTo(-56.419, 2));
  it('un n plus grand atténue davantage au-delà de d0', () =>
    expect(
      receivedPowerDbm(8, makeRadio({ model: 'log-distance', pathLossExponent: 4 })),
    ).toBeLessThan(
      receivedPowerDbm(8, makeRadio({ model: 'log-distance', pathLossExponent: 2 })),
    ));
});

describe('signalAt', () => {
  it('distance euclidienne 3-4-5', () => {
    const s = signalAt({ x: 3, y: 4 }, { x: 0, y: 0 }, makeRadio());
    expect(s.distanceM).toBeCloseTo(5, 9);
    expect(s.powerDbm).toBeCloseTo(receivedPowerDbm(5, makeRadio()), 9);
  });
});
