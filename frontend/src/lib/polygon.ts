/**
 * Géométrie des polygones de délimitation dessinés sur le plan.
 *
 * Toutes les entrées sont des coordonnées normalisées (x, y ∈ [0,1],
 * y = 0 en bas), comme le reste du projet. Les seuils de distance et d'aire
 * sont exprimés en pixels du plan pour rester indépendants de la résolution
 * de l'image importée.
 */
import { normalizedToPlanPixel, type NormalizedCoord } from './coords.js';

/** Nombre minimal de sommets distincts pour valider un polygone. */
export const MIN_POLYGON_VERTICES = 3;

/** Deux sommets plus proches que cette distance (px) sont considérés confondus. */
export const DISTINCT_VERTEX_TOLERANCE_PX = 1;

/** Aire minimale (px²) en dessous de laquelle un polygone est jugé dégénéré. */
export const MIN_POLYGON_AREA_PX2 = 1;

/** Nombre de sommets distincts, une fois les doublons fusionnés. */
export function countDistinctVertices(
  vertices: readonly NormalizedCoord[],
  width: number,
  height: number,
  tolerancePx = DISTINCT_VERTEX_TOLERANCE_PX,
): number {
  const distinct: NormalizedCoord[] = [];
  for (const vertex of vertices) {
    const candidate = normalizedToPlanPixel(vertex.x, vertex.y, width, height);
    const alreadySeen = distinct.some((seen) => {
      const point = normalizedToPlanPixel(seen.x, seen.y, width, height);
      return Math.hypot(candidate.xPx - point.xPx, candidate.yPx - point.yPx) <= tolerancePx;
    });
    if (!alreadySeen) distinct.push(vertex);
  }
  return distinct.length;
}

/** Aire absolue du polygone (formule du lacet), en pixels² du plan. */
export function polygonAreaPx2(
  vertices: readonly NormalizedCoord[],
  width: number,
  height: number,
): number {
  if (vertices.length < 3) return 0;

  const points = vertices.map((vertex) =>
    normalizedToPlanPixel(vertex.x, vertex.y, width, height),
  );
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.xPx * next.yPx - next.xPx * current.yPx;
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Un polygone est valide s'il possède au moins trois sommets distincts et une
 * aire non nulle. Les sommets confondus et les tracés colinéaires sont refusés.
 */
export function isValidPolygon(
  vertices: readonly NormalizedCoord[],
  width: number,
  height: number,
): boolean {
  return (
    countDistinctVertices(vertices, width, height) >= MIN_POLYGON_VERTICES &&
    polygonAreaPx2(vertices, width, height) >= MIN_POLYGON_AREA_PX2
  );
}

/** Tolérance (px²) en dessous de laquelle trois points sont jugés alignés. */
const COLLINEAR_EPSILON_PX2 = 1e-7;

/** Tolérance (px) pour tester l'appartenance d'un point au segment. */
const SEGMENT_EPSILON_PX = 1e-6;

function cross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function isPointOnSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return (
    px >= Math.min(ax, bx) - SEGMENT_EPSILON_PX &&
    px <= Math.max(ax, bx) + SEGMENT_EPSILON_PX &&
    py >= Math.min(ay, by) - SEGMENT_EPSILON_PX &&
    py <= Math.max(ay, by) + SEGMENT_EPSILON_PX
  );
}

function segmentsIntersect(
  a: { xPx: number; yPx: number },
  b: { xPx: number; yPx: number },
  c: { xPx: number; yPx: number },
  d: { xPx: number; yPx: number },
): boolean {
  const o1 = cross(a.xPx, a.yPx, b.xPx, b.yPx, c.xPx, c.yPx);
  const o2 = cross(a.xPx, a.yPx, b.xPx, b.yPx, d.xPx, d.yPx);
  const o3 = cross(c.xPx, c.yPx, d.xPx, d.yPx, a.xPx, a.yPx);
  const o4 = cross(c.xPx, c.yPx, d.xPx, d.yPx, b.xPx, b.yPx);

  const oppositeSigns = (p: number, q: number) =>
    (p > COLLINEAR_EPSILON_PX2 && q < -COLLINEAR_EPSILON_PX2) ||
    (p < -COLLINEAR_EPSILON_PX2 && q > COLLINEAR_EPSILON_PX2);

  if (oppositeSigns(o1, o2) && oppositeSigns(o3, o4)) return true;

  if (Math.abs(o1) <= COLLINEAR_EPSILON_PX2 && isPointOnSegment(a.xPx, a.yPx, b.xPx, b.yPx, c.xPx, c.yPx)) {
    return true;
  }
  if (Math.abs(o2) <= COLLINEAR_EPSILON_PX2 && isPointOnSegment(a.xPx, a.yPx, b.xPx, b.yPx, d.xPx, d.yPx)) {
    return true;
  }
  if (Math.abs(o3) <= COLLINEAR_EPSILON_PX2 && isPointOnSegment(c.xPx, c.yPx, d.xPx, d.yPx, a.xPx, a.yPx)) {
    return true;
  }
  return (
    Math.abs(o4) <= COLLINEAR_EPSILON_PX2 &&
    isPointOnSegment(c.xPx, c.yPx, d.xPx, d.yPx, b.xPx, b.yPx)
  );
}

/**
 * Détecte les croisements entre arêtes non adjacentes (auto-intersection).
 * Les arêtes voisines partagent un sommet par construction et sont ignorées.
 */
export function polygonSelfIntersects(
  vertices: readonly NormalizedCoord[],
  width: number,
  height: number,
): boolean {
  const points: Array<{ xPx: number; yPx: number }> = [];
  for (const vertex of vertices) {
    const point = normalizedToPlanPixel(vertex.x, vertex.y, width, height);
    const previous = points[points.length - 1];
    if (
      previous &&
      Math.hypot(point.xPx - previous.xPx, point.yPx - previous.yPx) <= SEGMENT_EPSILON_PX
    ) {
      continue;
    }
    points.push(point);
  }
  while (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.xPx - last.xPx, first.yPx - last.yPx) > SEGMENT_EPSILON_PX) break;
    points.pop();
  }

  const count = points.length;
  if (count < 4) return false;

  for (let index = 0; index < count; index += 1) {
    const nextIndex = (index + 1) % count;
    for (let other = index + 1; other < count; other += 1) {
      const otherNext = (other + 1) % count;
      if (other === nextIndex || otherNext === index) continue;
      if (
        segmentsIntersect(points[index], points[nextIndex], points[other], points[otherNext])
      ) {
        return true;
      }
    }
  }
  return false;
}

/* ==========================================================================
   Contraintes géométriques pour la heatmap
   --------------------------------------------------------------------------
   Les polygones ne fournissent aucun RSSI : ils servent uniquement à décider
   quels triangles Delaunay sont admissibles. Toutes les fonctions ci-dessous
   travaillent dans le repère pixel du plan (y en bas), avec une tolérance
   exprimée en pixels, indépendante de la résolution de l'image.
   ========================================================================== */

export interface PlanPixelPoint {
  xPx: number;
  yPx: number;
}

/** Tolérance géométrique (px) pour les tests de bord et d'alignement. */
const GEOMETRY_EPSILON_PX = 1e-6;

/** Convertit des sommets normalisés en sommets pixel du plan. */
export function toPolygonPixelVertices(
  vertices: readonly NormalizedCoord[],
  width: number,
  height: number,
): PlanPixelPoint[] {
  return vertices.map((vertex) =>
    normalizedToPlanPixel(vertex.x, vertex.y, width, height),
  );
}

function isPointOnSegmentPx(
  xPx: number,
  yPx: number,
  a: PlanPixelPoint,
  b: PlanPixelPoint,
): boolean {
  const dx = b.xPx - a.xPx;
  const dy = b.yPx - a.yPx;
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON_PX) {
    return Math.hypot(xPx - a.xPx, yPx - a.yPx) <= GEOMETRY_EPSILON_PX;
  }
  const distanceToLine = Math.abs(dx * (yPx - a.yPx) - dy * (xPx - a.xPx)) / length;
  if (distanceToLine > GEOMETRY_EPSILON_PX) return false;
  return (
    xPx >= Math.min(a.xPx, b.xPx) - GEOMETRY_EPSILON_PX &&
    xPx <= Math.max(a.xPx, b.xPx) + GEOMETRY_EPSILON_PX &&
    yPx >= Math.min(a.yPx, b.yPx) - GEOMETRY_EPSILON_PX &&
    yPx <= Math.max(a.yPx, b.yPx) + GEOMETRY_EPSILON_PX
  );
}

/**
 * Test d'appartenance à un polygone simple, bord inclus (lancer de rayon).
 * `polygonPx` doit contenir au moins trois sommets.
 */
export function pointInPolygonPx(
  xPx: number,
  yPx: number,
  polygonPx: readonly PlanPixelPoint[],
): boolean {
  if (polygonPx.length < 3) return false;
  if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) return false;

  for (let index = 0; index < polygonPx.length; index += 1) {
    const current = polygonPx[index];
    const next = polygonPx[(index + 1) % polygonPx.length];
    if (isPointOnSegmentPx(xPx, yPx, current, next)) return true;
  }

  let inside = false;
  for (
    let index = 0, previous = polygonPx.length - 1;
    index < polygonPx.length;
    previous = index, index += 1
  ) {
    const current = polygonPx[index];
    const before = polygonPx[previous];
    if ((current.yPx > yPx) !== (before.yPx > yPx)) {
      const intersectionX =
        current.xPx +
        ((yPx - current.yPx) * (before.xPx - current.xPx)) /
          (before.yPx - current.yPx);
      if (xPx < intersectionX) inside = !inside;
    }
  }
  return inside;
}

function cross2(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Paramètres t ∈ [0,1] des intersections entre le segment AB et l'arête CD.
 * Gère aussi le cas colinéaire (recouvrement partiel) pour découper AB aux
 * points où son statut intérieur/extérieur peut changer.
 */
function segmentIntersectionParameters(
  a: PlanPixelPoint,
  b: PlanPixelPoint,
  c: PlanPixelPoint,
  d: PlanPixelPoint,
): number[] {
  const rx = b.xPx - a.xPx;
  const ry = b.yPx - a.yPx;
  const sx = d.xPx - c.xPx;
  const sy = d.yPx - c.yPx;
  const lengthAB = Math.hypot(rx, ry);
  const lengthCD = Math.hypot(sx, sy);

  if (lengthCD <= GEOMETRY_EPSILON_PX) {
    if (!isPointOnSegmentPx(c.xPx, c.yPx, a, b)) return [];
    const lengthSquared = rx * rx + ry * ry;
    if (lengthSquared <= GEOMETRY_EPSILON_PX * GEOMETRY_EPSILON_PX) return [];
    const t =
      ((c.xPx - a.xPx) * rx + (c.yPx - a.yPx) * ry) / lengthSquared;
    return t >= -1e-12 && t <= 1 + 1e-12 ? [Math.max(0, Math.min(1, t))] : [];
  }

  const denominator = cross2(rx, ry, sx, sy);
  const qpx = c.xPx - a.xPx;
  const qpy = c.yPx - a.yPx;
  const parallelThreshold = 1e-12 * Math.max(1, lengthAB * lengthCD);

  if (Math.abs(denominator) <= parallelThreshold) {
    const distanceToLine =
      Math.abs(cross2(qpx, qpy, rx, ry)) / Math.max(lengthAB, GEOMETRY_EPSILON_PX);
    if (distanceToLine > GEOMETRY_EPSILON_PX) return [];
    const lengthSquared = rx * rx + ry * ry;
    if (lengthSquared <= GEOMETRY_EPSILON_PX * GEOMETRY_EPSILON_PX) return [];
    const parameters: number[] = [];
    for (const endpoint of [c, d]) {
      const t =
        ((endpoint.xPx - a.xPx) * rx + (endpoint.yPx - a.yPx) * ry) /
        lengthSquared;
      if (t >= -1e-12 && t <= 1 + 1e-12) {
        parameters.push(Math.max(0, Math.min(1, t)));
      }
    }
    return parameters;
  }

  const t = cross2(qpx, qpy, sx, sy) / denominator;
  const u = cross2(qpx, qpy, rx, ry) / denominator;
  if (t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12) {
    return [Math.max(0, Math.min(1, t))];
  }
  return [];
}

/**
 * Vérifie qu'un segment est entièrement contenu dans le polygone.
 *
 * AB est découpé à chaque intersection avec le contour, puis le milieu de
 * chaque sous-intervalle est testé. Entre deux intersections consécutives, le
 * statut intérieur/extérieur ne peut pas changer : la vérification est donc
 * exacte (à la tolérance numérique près), y compris pour une concavité.
 */
export function segmentWithinPolygonPx(
  a: PlanPixelPoint,
  b: PlanPixelPoint,
  polygonPx: readonly PlanPixelPoint[],
): boolean {
  if (polygonPx.length < 3) return false;

  const parameters = [0, 1];
  for (let index = 0; index < polygonPx.length; index += 1) {
    const c = polygonPx[index];
    const d = polygonPx[(index + 1) % polygonPx.length];
    parameters.push(...segmentIntersectionParameters(a, b, c, d));
  }
  parameters.sort((left, right) => left - right);

  const unique: number[] = [];
  for (const parameter of parameters) {
    const previous = unique[unique.length - 1];
    if (previous === undefined || Math.abs(parameter - previous) > 1e-12) {
      unique.push(parameter);
    }
  }

  for (let index = 0; index < unique.length - 1; index += 1) {
    const start = unique[index];
    const end = unique[index + 1];
    if (end - start <= 1e-12) continue;
    const middle = (start + end) / 2;
    const xPx = a.xPx + (b.xPx - a.xPx) * middle;
    const yPx = a.yPx + (b.yPx - a.yPx) * middle;
    if (!pointInPolygonPx(xPx, yPx, polygonPx)) return false;
  }
  return true;
}

/**
 * Un polygone est « utilisable » quand il est valide et non auto-intersecté.
 *
 * Ce critère est la source de vérité unique des deux couches de la heatmap :
 * la contrainte de triangulation (`buildRssiMeshes`) et le masque IDW
 * (`CoverageOverlay`) passent tous deux par `buildZoneMask`, qui l'applique.
 * Une zone refusée ici est donc absente des deux couches à la fois — jamais
 * affichée en débit et masquée en RSSI, ou l'inverse.
 */
export function isUsablePolygon(
  vertices: readonly NormalizedCoord[],
  width: number,
  height: number,
): boolean {
  return (
    isValidPolygon(vertices, width, height) &&
    !polygonSelfIntersects(vertices, width, height)
  );
}

/** Masque de zone en pixels du plan (y en bas), prêt pour `pointInPolygonPx`. */
export interface ZoneMask {
  pixels: PlanPixelPoint[];
  /** Emprise des sommets, pour élaguer les tests de pixels. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Construit le masque d'une zone, ou `null` si le polygone est inexploitable
 * (moins de trois sommets distincts, aire nulle, tracé auto-intersecté,
 * entrée malformée reçue de l'API).
 *
 * Retourner `null` — plutôt que de passer au polygone suivant — permet à
 * l'appelant de distinguer « cette zone n'existe pas » de « aucune zone n'est
 * valide » : dans ce dernier cas, il ne doit rien être affiché du tout.
 */
export function buildZoneMask(
  vertices: readonly NormalizedCoord[] | null | undefined,
  width: number,
  height: number,
): ZoneMask | null {
  if (!Array.isArray(vertices)) return null;
  if (!isUsablePolygon(vertices, width, height)) return null;

  const pixels = toPolygonPixelVertices(vertices, width, height);

  let minX = pixels[0].xPx;
  let maxX = pixels[0].xPx;
  let minY = pixels[0].yPx;
  let maxY = pixels[0].yPx;
  for (const pixel of pixels) {
    if (pixel.xPx < minX) minX = pixel.xPx;
    if (pixel.xPx > maxX) maxX = pixel.xPx;
    if (pixel.yPx < minY) minY = pixel.yPx;
    if (pixel.yPx > maxY) maxY = pixel.yPx;
  }
  return { pixels, minX, maxX, minY, maxY };
}

/**
 * Un triangle est admissible si ses trois arêtes sont entièrement contenues
 * dans le polygone. Pour un polygone simple (sans trou), cela garantit que
 * toute la surface du triangle l'est aussi : une portion extérieure devrait
 * traverser le contour, ce que le test des arêtes interdit.
 *
 * Vérifier seulement le centre ou les sommets ne suffit pas : un triangle
 * concave peut passer au-dessus d'une zone exclue avec ses trois sommets à
 * l'intérieur.
 */
export function triangleInsidePolygonPx(
  a: PlanPixelPoint,
  b: PlanPixelPoint,
  c: PlanPixelPoint,
  polygonPx: readonly PlanPixelPoint[],
): boolean {
  return (
    segmentWithinPolygonPx(a, b, polygonPx) &&
    segmentWithinPolygonPx(b, c, polygonPx) &&
    segmentWithinPolygonPx(c, a, polygonPx)
  );
}
