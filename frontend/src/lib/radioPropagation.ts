/**
 * Moteur physique, sans dépendance à React ni au DOM.
 *
 * Unités :
 *  - distances en mètres (converties en km pour la formule FSPL)
 *  - fréquences en MHz (GHz -> MHz via `ghzToMhz`)
 *  - puissances en dBm, gains en dBi, pertes en dB
 *
 * Modèle FSPL (défaut) :
 *   FSPL(dB) = 32.44 + 20·log10(f_MHz) + 20·log10(d_km)
 *   Pr(dBm)  = EIRP(dBm) - FSPL(dB) + Gr(dBi)
 *   L'EIRP inclut déjà le gain d'émission : il n'est pas ajouté une 2e fois.
 *
 * Modèle log-distance (optionnel) :
 *   Pr(d) = Pr(d0) - 10·n·log10(d / d0)
 *   Pr(d0) est ancré sur le FSPL à d0 : EIRP - FSPL(d0) + Gr.
 *   Avec n = 2, il coïncide donc exactement avec le FSPL.
 *
 * Limites : espace libre isotrope, un seul AP, ni murs, ni obstacles, ni
 * interférences, ni multi-trajets, ni évanouissements (fading), ni diagramme
 * d'antenne. Les valeurs sont simulées, pas mesurées.
 */
import type { Point, RadioParams, SignalSample } from '../types/wifi';

export const FSPL_CONSTANT_DB = 32.44;
export const DEFAULT_MIN_DISTANCE_M = 0.1;

const METERS_PER_KILOMETER = 1000;
const MHZ_PER_GHZ = 1000;

export const ghzToMhz = (ghz: number): number => ghz * MHZ_PER_GHZ;
export const metersToKilometers = (m: number): number =>
  m / METERS_PER_KILOMETER;
export const dbmToMilliwatts = (dbm: number): number => Math.pow(10, dbm / 10);
export const milliwattsToDbm = (mw: number): number => 10 * Math.log10(mw);

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Ramène la distance à au moins `minDistanceM` (valeur par défaut si invalide). */
export function clampDistance(distanceM: number, minDistanceM: number): number {
  const floor = minDistanceM > 0 ? minDistanceM : DEFAULT_MIN_DISTANCE_M;
  return Math.max(Math.abs(distanceM), floor);
}

/** Perte en espace libre, en dB. */
export function fsplDb(
  distanceM: number,
  frequencyMHz: number,
  minDistanceM: number = DEFAULT_MIN_DISTANCE_M,
): number {
  const dKm = metersToKilometers(clampDistance(distanceM, minDistanceM));
  return (
    FSPL_CONSTANT_DB + 20 * Math.log10(frequencyMHz) + 20 * Math.log10(dKm)
  );
}

export function receivedPowerFsplDbm(
  distanceM: number,
  radio: RadioParams,
): number {
  return (
    radio.eirpDbm -
    fsplDb(distanceM, radio.frequencyMHz, radio.minDistanceM) +
    radio.rxGainDbi
  );
}

/** d0 effectif : jamais inférieur à la distance plancher. */
export function effectiveReferenceDistanceM(radio: RadioParams): number {
  return clampDistance(radio.referenceDistanceM, radio.minDistanceM);
}

/** Pr(d0) en dBm, ancré sur le FSPL à d0. */
export function referencePowerDbm(radio: RadioParams): number {
  const d0 = effectiveReferenceDistanceM(radio);
  return (
    radio.eirpDbm -
    fsplDb(d0, radio.frequencyMHz, radio.minDistanceM) +
    radio.rxGainDbi
  );
}

export function receivedPowerLogDistanceDbm(
  distanceM: number,
  radio: RadioParams,
): number {
  const d0 = effectiveReferenceDistanceM(radio);
  const d = clampDistance(distanceM, radio.minDistanceM);
  return (
    referencePowerDbm(radio) - 10 * radio.pathLossExponent * Math.log10(d / d0)
  );
}

export function receivedPowerDbm(distanceM: number, radio: RadioParams): number {
  return radio.model === 'log-distance'
    ? receivedPowerLogDistanceDbm(distanceM, radio)
    : receivedPowerFsplDbm(distanceM, radio);
}

export function signalAt(
  point: Point,
  ap: Point,
  radio: RadioParams,
): SignalSample {
  const distanceM = distanceBetween(point, ap);
  return { distanceM, powerDbm: receivedPowerDbm(distanceM, radio) };
}
