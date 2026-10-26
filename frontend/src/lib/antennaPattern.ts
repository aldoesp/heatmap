import type { AntennaPattern } from '../types/wifi';

export const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

export const flatPattern = (peakGainDbi = 0): AntennaPattern => ({
  peakGainDbi,
  azimuthDb: new Array<number>(360).fill(0),
  elevationDb: new Array<number>(360).fill(0),
});

/** Interpolation linéaire sur un tableau circulaire (1 valeur par degré). */
export function sampleCircular(table: readonly number[], deg: number): number {
  const n = table.length;
  if (n === 0) return 0;
  const x = normalizeDeg(deg) * (n / 360);
  const i0 = Math.floor(x) % n;
  const i1 = (i0 + 1) % n;
  const t = x - Math.floor(x);
  return table[i0] * (1 - t) + table[i1] * t;
}

export const azimuthGainDb = (p: AntennaPattern, azimuthDeg: number): number =>
  sampleCircular(p.azimuthDb, azimuthDeg);

/** Coupe verticale vue depuis le nadir (0..180°) : moyenne des deux côtés du cercle. */
export function elevationGainDb(p: AntennaPattern, nadirDeg: number): number {
  const theta = Math.min(Math.max(nadirDeg, 0), 180);
  return 0.5 * (sampleCircular(p.elevationDb, theta) + sampleCircular(p.elevationDb, -theta));
}

export function txGainDbi(p: AntennaPattern, azimuthDeg: number, nadirDeg: number): number {
  const nadirRad = Math.min(Math.max(nadirDeg, 0), 180) * Math.PI / 180;
  return p.peakGainDbi + azimuthGainDb(p, azimuthDeg) * Math.sin(nadirRad) + elevationGainDb(p, nadirDeg);
}
