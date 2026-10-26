import { describe, expect, it } from 'vitest';
import type { FrequencyMHz } from '../types/wifi';
import { flatPattern, azimuthGainDb, elevationGainDb, txGainDbi } from './antennaPattern';
import { U7_PRO_XGS_PATTERNS } from '../data/u7ProXgsPatterns';
import { resolveAntenna } from './antennas';

function maxMinusMin(table: readonly number[]): number {
  const min = Math.min(...table);
  const max = Math.max(...table);
  return max - min;
}

function maxGapConsecutive(table: readonly number[]): number {
  let maxGap = 0;
  for (let i = 0; i < table.length; i++) {
    const j = (i + 1) % table.length;
    const gap = Math.abs(table[j] - table[i]);
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

describe('U7_PRO_XGS_PATTERNS', () => {
  const frequencies: FrequencyMHz[] = [2400, 5000, 6000];

  for (const freq of frequencies) {
    const pattern = U7_PRO_XGS_PATTERNS[freq];

    it(`${freq} MHz : azimuthDb et elevationDb comportent 360 valeurs`, () => {
      expect(pattern.azimuthDb).toHaveLength(360);
      expect(pattern.elevationDb).toHaveLength(360);
    });

    it(`${freq} MHz : aucune valeur > 0 et max vaut 0`, () => {
      const az = pattern.azimuthDb;
      const el = pattern.elevationDb;
      expect(az.every((v) => v <= 0)).toBe(true);
      expect(el.every((v) => v <= 0)).toBe(true);
      expect(Math.max(...az)).toBe(0);
      expect(Math.max(...el)).toBe(0);
    });

    it(`${freq} MHz : azimuthDb max - min < 10 dB`, () => {
      expect(maxMinusMin(pattern.azimuthDb)).toBeLessThan(10);
    });

    it(`${freq} MHz : azimuthDb écart consécutif <= 1 dB`, () => {
      expect(maxGapConsecutive(pattern.azimuthDb)).toBeLessThanOrEqual(1);
    });
  }

  describe('resolveAntenna', () => {
    for (const [freq, expectedPeak] of [
      [2400, 4],
      [5000, 6],
      [6000, 6],
    ] as const) {
      it(`resolveAntenna('u7-pro-xgs', ${freq}).peakGainDbi vaut ${expectedPeak}`, () => {
        expect(resolveAntenna('u7-pro-xgs', freq).peakGainDbi).toBe(expectedPeak);
      });
    }
  });

  it('flatPattern(6) donne txGainDbi(p, 123, 45) égal à 6', () => {
    const antenna = flatPattern(6);
    const result = txGainDbi(antenna, 123, 45);
    expect(result).toBe(6);
  });

  it('U7_PRO_XGS_PATTERNS[5000] : à nadirDeg = 0, txGainDbi identique pour azimuth 0, 90, 180, 270', () => {
    const pattern = U7_PRO_XGS_PATTERNS[5000];
    const result0 = txGainDbi(pattern, 0, 0);
    const result90 = txGainDbi(pattern, 90, 0);
    const result180 = txGainDbi(pattern, 180, 0);
    const result270 = txGainDbi(pattern, 270, 0);
    expect(result0).toBe(result90);
    expect(result0).toBe(result180);
    expect(result0).toBe(result270);
  });

  it('U7_PRO_XGS_PATTERNS[5000] : à nadirDeg = 90, txGainDbi = peakGainDbi + azimuthGainDb + elevationGainDb', () => {
    const pattern = U7_PRO_XGS_PATTERNS[5000];
    const azimuthAt0 = azimuthGainDb(pattern, 0);
    const elevationAt90 = elevationGainDb(pattern, 90);
    const expected = pattern.peakGainDbi + azimuthAt0 + elevationAt90;
    const result = txGainDbi(pattern, 0, 90);
    expect(result).toBe(expected);
  });
});