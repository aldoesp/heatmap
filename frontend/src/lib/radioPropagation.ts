/**
 * Moteur physique, sans dépendance à React ni au DOM.
 *
 * Unités : distances en m (converties en km pour le FSPL), fréquences en MHz,
 * puissances en dBm, gains en dBi, pertes en dB.
 *
 * Bilan de liaison :
 *   Pr(dBm) = Ptx(dBm) + Gtx(azimut, nadir)(dBi) - FSPL(dB) + Gr(dBi)
 *   L'EIRP n'est plus un paramètre : EIRP(direction) = Ptx + Gtx(direction).
 *   Le gain d'émission n'est donc compté qu'une seule fois.
 *
 * FSPL(dB) = 32.44 + 20·log10(f_MHz) + 20·log10(d_km), d = distance 3D.
 *
 * Log-distance (optionnel) : Pr(d) = Pr(d0) - 10·n·log10(d / d0), avec Pr(d0)
 * ancré sur le FSPL à d0 (même gain d'émission). Avec n = 2 il redonne le FSPL.
 *
 * Limites : un seul AP, ni murs, ni obstacles, ni interférences, ni multi-trajets,
 * ni fading ; diagramme d'antenne approché par deux coupes (azimut + élévation).
 * Les valeurs sont simulées, pas mesurées.
 */
import type { AntennaPattern, Point, RadioParams, SignalSample } from '../types/wifi';
import { normalizeDeg, txGainDbi } from './antennaPattern';

export const FSPL_CONSTANT_DB = 32.44;
export const DEFAULT_MIN_DISTANCE_M = 0.1;

const METERS_PER_KILOMETER = 1000;
const MHZ_PER_GHZ = 1000;
const RAD_TO_DEG = 180 / Math.PI;

export const ghzToMhz = (ghz: number): number => ghz * MHZ_PER_GHZ;
export const metersToKilometers = (m: number): number => m / METERS_PER_KILOMETER;
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
  return FSPL_CONSTANT_DB + 20 * Math.log10(frequencyMHz) + 20 * Math.log10(dKm);
}

/** EIRP de crête : puissance d'émission + gain maximal de l'antenne. */
export const peakEirpDbm = (radio: RadioParams, antenna: AntennaPattern): number =>
  radio.txPowerDbm + antenna.peakGainDbi;

export interface LinkGeometry {
  horizontalM: number;
  /** Distance 3D (tient compte de la différence de hauteur). */
  distanceM: number;
  /** Azimut relatif à l'orientation de l'AP, dans [0, 360). */
  azimuthDeg: number;
  /** Angle depuis le nadir : 0° sous l'AP, 90° à l'horizon. */
  nadirDeg: number;
}

/** Géométrie AP -> récepteur ; (dx, dy) = récepteur - AP, en mètres. */
export function linkGeometry(dx: number, dy: number, radio: RadioParams): LinkGeometry {
  const horizontalM = Math.hypot(dx, dy);
  const dz = radio.apHeightM - radio.rxHeightM;
  return {
    horizontalM,
    distanceM: Math.hypot(horizontalM, dz),
    azimuthDeg: normalizeDeg(Math.atan2(dy, dx) * RAD_TO_DEG - radio.apRotationDeg),
    nadirDeg: Math.atan2(horizontalM, dz) * RAD_TO_DEG,
  };
}

export function receivedPowerFsplDbm(
  distanceM: number,
  radio: RadioParams,
  txGain: number,
): number {
  return (
    radio.txPowerDbm +
    txGain -
    fsplDb(distanceM, radio.frequencyMHz, radio.minDistanceM) +
    radio.rxGainDbi
  );
}

/** d0 effectif : jamais inférieur à la distance plancher. */
export function effectiveReferenceDistanceM(radio: RadioParams): number {
  return clampDistance(radio.referenceDistanceM, radio.minDistanceM);
}

/** Pr(d0) en dBm, ancré sur le FSPL à d0, pour un gain d'émission donné. */
export function referencePowerDbm(radio: RadioParams, txGain: number): number {
  return receivedPowerFsplDbm(effectiveReferenceDistanceM(radio), radio, txGain);
}

export function receivedPowerLogDistanceDbm(
  distanceM: number,
  radio: RadioParams,
  txGain: number,
): number {
  const d0 = effectiveReferenceDistanceM(radio);
  const d = clampDistance(distanceM, radio.minDistanceM);
  return referencePowerDbm(radio, txGain) - 10 * radio.pathLossExponent * Math.log10(d / d0);
}

export function receivedPowerDbm(
  distanceM: number,
  radio: RadioParams,
  txGain: number,
): number {
  return radio.model === 'log-distance'
    ? receivedPowerLogDistanceDbm(distanceM, radio, txGain)
    : receivedPowerFsplDbm(distanceM, radio, txGain);
}

/** Puissance reçue en un point de la surface. */
export function signalAt(
  point: Point,
  ap: Point,
  radio: RadioParams,
  antenna: AntennaPattern,
): SignalSample {
  const g = linkGeometry(point.x - ap.x, point.y - ap.y, radio);
  const gain = txGainDbi(antenna, g.azimuthDeg, g.nadirDeg);
  return {
    distanceM: g.distanceM,
    horizontalM: g.horizontalM,
    txGainDbi: gain,
    powerDbm: receivedPowerDbm(g.distanceM, radio, gain),
  };
}
