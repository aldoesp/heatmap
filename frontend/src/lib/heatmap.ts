const RADIUS_KEY = 'heatmap:radiusPx';

/** Rayon choisi par l'utilisateur, en pixels (10–120), ou null pour l'auto. */
export function getHeatmapRadius(): number | null {
  try {
    const raw = localStorage.getItem(RADIUS_KEY);
    if (raw === null) return null;
    const radius = Number(raw);
    if (Number.isInteger(radius) && radius >= 10 && radius <= 120) return radius;
  } catch {
    /* stockage indisponible */
  }
  return null;
}

export function setHeatmapRadius(radius: number): void {
  if (!Number.isInteger(radius) || radius < 10 || radius > 120) return;
  try {
    localStorage.setItem(RADIUS_KEY, String(radius));
  } catch {
    /* silencieux */
  }
}

/**
 * Rayon de base en pixels d'après l'emprise des points (adapté de
 * calculateRadiusByBoundingBox de l'upstream wifi-heatmapper) :
 * assez grand pour fusionner les zones proches, borné pour rester lisible.
 */
export function calculateAutoRadius(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number
): number {
  if (points.length === 0) return 30;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const areaPx = (maxX - minX) * width * ((maxY - minY) * height);
  if (!(areaPx > 0)) return 30;
  const radius = Math.sqrt(areaPx / (points.length * Math.PI)) * 2;
  return Math.max(10, Math.min(120, Math.round(radius)));
}
