/** Calcul de la grille et mapping couleur. Aucune dépendance à React. */
import type {
  ColorStop,
  HeatmapGrid,
  Point,
  RadioParams,
  Rgb,
  Surface,
} from '../types/wifi';
import { receivedPowerDbm } from './radioPropagation';

export const MAX_CELLS = 250_000;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);

export const clampPoint = (p: Point, s: Surface): Point => ({
  x: clamp(p.x, 0, s.widthM),
  y: clamp(p.y, 0, s.heightM),
});

export const surfaceCenter = (s: Surface): Point => ({
  x: s.widthM / 2,
  y: s.heightM / 2,
});

/** Résolution réellement utilisée : plafonne le nombre de cellules. */
export function effectiveResolutionM(surface: Surface, requestedM: number): number {
  const minRes = Math.sqrt((surface.widthM * surface.heightM) / MAX_CELLS);
  return Math.max(requestedM, minRes);
}

export function computeHeatmapGrid(
  surface: Surface,
  resolutionM: number,
  ap: Point,
  radio: RadioParams,
): HeatmapGrid {
  const res = effectiveResolutionM(surface, resolutionM);
  const cols = Math.max(1, Math.ceil(surface.widthM / res - 1e-9));
  const rows = Math.max(1, Math.ceil(surface.heightM / res - 1e-9));
  const cellWidthM = surface.widthM / cols;
  const cellHeightM = surface.heightM / rows;
  const powersDbm = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const dy = (r + 0.5) * cellHeightM - ap.y;
    for (let c = 0; c < cols; c++) {
      const dx = (c + 0.5) * cellWidthM - ap.x;
      powersDbm[r * cols + c] = receivedPowerDbm(Math.hypot(dx, dy), radio);
    }
  }
  return { cols, rows, cellWidthM, cellHeightM, powersDbm };
}

/**
 * Couleur pour une puissance : interpolation linéaire entre les ancres.
 * `stops` doit être trié par seuil décroissant.
 */
export function colorForDbm(dbm: number, stops: readonly ColorStop[]): Rgb {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (dbm >= first.thresholdDbm) return first.rgb;
  if (dbm <= last.thresholdDbm) return last.rgb;
  for (let i = 0; i < stops.length - 1; i++) {
    const hi = stops[i];
    const lo = stops[i + 1];
    if (dbm < hi.thresholdDbm && dbm >= lo.thresholdDbm) {
      const span = hi.thresholdDbm - lo.thresholdDbm;
      const t = span > 0 ? (hi.thresholdDbm - dbm) / span : 1;
      return [
        hi.rgb[0] + (lo.rgb[0] - hi.rgb[0]) * t,
        hi.rgb[1] + (lo.rgb[1] - hi.rgb[1]) * t,
        hi.rgb[2] + (lo.rgb[2] - hi.rgb[2]) * t,
      ];
    }
  }
  return last.rgb;
}

/** Pixels RGBA (1 pixel par cellule) ; l'agrandissement lisse est fait par le Canvas. */
export function gridToRgba(
  grid: HeatmapGrid,
  stops: readonly ColorStop[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grid.cols * grid.rows * 4);
  for (let i = 0; i < grid.powersDbm.length; i++) {
    const [r, g, b] = colorForDbm(grid.powersDbm[i], stops);
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}
