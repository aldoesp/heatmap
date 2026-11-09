export type ExportArea = 'full' | 'visible';

/** Région du plan exportée, en pixels canvas (origine en haut à gauche). */
export interface PlanRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Limites géographiques du viewport Leaflet en CRS.Simple. */
export interface ViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Rectangle source dans une image (origine en haut à gauche). */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function fullPlanRegion(width: number, height: number): PlanRegion {
  return { x: 0, y: 0, width, height };
}

/**
 * Convertit les limites du viewport Leaflet en région du plan.
 *
 * En CRS.Simple, la latitude correspond à l'axe Y du plan (origine en bas)
 * et la longitude à l'axe X. L'image du plan ayant son origine en haut à
 * gauche, il faut inverser l'axe Y. Les limites sont ensuite ramenées dans
 * l'emprise du plan pour ne jamais exporter de zone vide.
 */
export function planRegionFromBounds(
  bounds: ViewportBounds,
  planWidth: number,
  planHeight: number,
): PlanRegion {
  if (
    !Number.isFinite(planWidth) ||
    !Number.isFinite(planHeight) ||
    planWidth <= 0 ||
    planHeight <= 0
  ) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const left = Math.min(bounds.west, bounds.east);
  const right = Math.max(bounds.west, bounds.east);
  const south = Math.min(bounds.south, bounds.north);
  const north = Math.max(bounds.south, bounds.north);

  const x = clamp(Math.round(left), 0, planWidth);
  const rightPixel = clamp(Math.round(right), 0, planWidth);
  const y = clamp(Math.round(planHeight - north), 0, planHeight);
  const bottomPixel = clamp(Math.round(planHeight - south), 0, planHeight);

  return {
    x,
    y,
    width: Math.max(0, rightPixel - x),
    height: Math.max(0, bottomPixel - y),
  };
}

export function planRegionIsExportable(
  region: PlanRegion,
  planWidth: number,
  planHeight: number,
): boolean {
  return (
    Number.isSafeInteger(region.x) &&
    Number.isSafeInteger(region.y) &&
    Number.isSafeInteger(region.width) &&
    Number.isSafeInteger(region.height) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width > 0 &&
    region.height > 0 &&
    region.x + region.width <= planWidth &&
    region.y + region.height <= planHeight
  );
}

/** Convertit une région du plan en rectangle source dans une image de plan. */
export function planRegionToSourceRect(
  region: PlanRegion,
  planWidth: number,
  planHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): SourceRect {
  const scaleX = sourceWidth / planWidth;
  const scaleY = sourceHeight / planHeight;
  return {
    x: region.x * scaleX,
    y: region.y * scaleY,
    width: region.width * scaleX,
    height: region.height * scaleY,
  };
}
