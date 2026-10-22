/**
 * Calibration et conversions de coordonnées entre les repères du projet.
 *
 * Les trois repères en présence :
 *   1. Données normalisées (API)  : x, y ∈ [0, 1], y = 0 en BAS (façon Leaflet).
 *   2. Pixels de l'image de plan  : origine en haut à gauche, y vers le bas.
 *   3. Repère RF (`types/wifi`)   : mètres, x vers la droite, y = 0 en haut.
 *      C'est le repère de `computeHeatmapGrid` et de la `Surface`.
 *
 * Conversion clé : simY = (1 − y_normalisé) × hauteur_m.
 */
import type { Point, Surface } from '../types/wifi';

/** Plan image + échelle validée. */
export interface CalibratedPlan {
  width: number;
  height: number;
  metersPerPixel: number;
}

/**
 * Bornes de la calibration, en mètres par pixel (identiques à la validation
 * backend de `PATCH /api/v1/plans/:id/calibration`) : une image de plan fait
 * typiquement 1000–5000 px de côté pour 5–100 m, soit 0,001–0,1 m/px. Les
 * bornes élargies (5 mm/px à 10 m/px) acceptent aussi les plans grossiers.
 */
export const MIN_METERS_PER_PIXEL = 0.0005;
export const MAX_METERS_PER_PIXEL = 10;

export interface PlanLike {
  width: number;
  height: number;
  metersPerPixel: number | null;
}

/** Valeur acceptée : nombre fini strictement dans les bornes. */
export function isValidMetersPerPixel(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_METERS_PER_PIXEL &&
    value <= MAX_METERS_PER_PIXEL
  );
}

/** Distance de calibration réelle acceptée : 0,1 m à 1000 m. */
export const MIN_CALIBRATION_DISTANCE_M = 0.1;
export const MAX_CALIBRATION_DISTANCE_M = 1000;

export function isValidCalibrationDistanceM(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= MIN_CALIBRATION_DISTANCE_M &&
    value <= MAX_CALIBRATION_DISTANCE_M
  );
}

/**
 * Échelle en m/px à partir de deux points cliqués (en pixels de l'image
 * de plan) et de la distance réelle entre eux. Renvoie null si les points
 * sont confondus, si les entrées sont invalides ou si le résultat sort des
 * bornes de la calibration.
 */
export function computeMetersPerPixel(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  distanceM: number,
): number | null {
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  if (!isValidCalibrationDistanceM(distanceM)) return null;
  const pixelDistance = Math.hypot(bx - ax, by - ay);
  // Segments de moins de 5 px : bruit de clic, points quasi confondus.
  if (pixelDistance < 5) return null;
  const mpp = distanceM / pixelDistance;
  return isValidMetersPerPixel(mpp) ? mpp : null;
}

/**
 * Surface du moteur RF pour un plan calibré, ou null si la calibration est
 * absente / invalide : la simulation ne doit JAMAIS inventer une échelle.
 */
export function simulationSurfaceOf(plan: PlanLike | null): Surface | null {
  if (!plan) return null;
  if (
    !Number.isSafeInteger(plan.width) ||
    plan.width <= 0 ||
    !Number.isSafeInteger(plan.height) ||
    plan.height <= 0
  ) {
    return null;
  }
  if (!isValidMetersPerPixel(plan.metersPerPixel)) return null;
  return {
    widthM: plan.width * plan.metersPerPixel,
    heightM: plan.height * plan.metersPerPixel,
  };
}

/** Normalisé (y = 0 en bas) -> mètres RF (y = 0 en haut). */
export function normalizedToMetersPoint(
  x: number,
  y: number,
  surface: Surface,
): Point {
  return { x: x * surface.widthM, y: (1 - y) * surface.heightM };
}

/** Mètres RF (y = 0 en haut) -> normalisé (y = 0 en bas). */
export function metersToNormalizedPoint(
  p: Point,
  surface: Surface,
): { x: number; y: number } {
  return {
    x: p.x / surface.widthM,
    y: 1 - p.y / surface.heightM,
  };
}

/** Pixels de l'image de plan (origine haut-gauche) -> mètres RF. */
export function planPixelsToMeters(px: number, py: number, plan: CalibratedPlan): Point {
  return { x: px * plan.metersPerPixel, y: py * plan.metersPerPixel };
}

/** Mètres RF -> pixels de l'image de plan (origine haut-gauche). */
export function metersToPlanPixels(p: Point, plan: CalibratedPlan): { x: number; y: number } {
  return { x: p.x / plan.metersPerPixel, y: p.y / plan.metersPerPixel };
}

/**
 * Convertit une position cliquée dans l'élément <img> affiché en pixels de
 * l'image de plan originale (l'image est souvent redimensionnée par le CSS).
 * L'axe Y suit la même proportion : la même fonction s'applique aux deux axes.
 */
export function displayPxToPlanPx(
  offsetX: number,
  displayWidthPx: number,
  planImageWidthPx: number,
): number {
  if (!(displayWidthPx > 0) || !(planImageWidthPx > 0)) return NaN;
  return (offsetX * planImageWidthPx) / displayWidthPx;
}

/** Distance métrique entre deux positions normalisées (pour l'affichage). */
export function normalizedDistanceM(
  a: { x: number; y: number },
  b: { x: number; y: number },
  surface: Surface,
): number {
  const dx = (a.x - b.x) * surface.widthM;
  const dy = (a.y - b.y) * surface.heightM;
  return Math.hypot(dx, dy);
}
