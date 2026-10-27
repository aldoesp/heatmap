import type { HeatmapRow } from '../types/api.js';
import type { NormalizedCoord } from './coords.js';
import {
  buildZoneMask,
  pointInPolygonPx,
  triangleInsidePolygonPx,
  type PlanPixelPoint,
} from './polygon.js';
import {
  triangulateRssi,
  type Band,
  type InterpolationMesh,
  type PlanReference,
  type RssiMeasurement,
  type TriangulationResult,
} from './triangulation.js';

export type RssiMeshBuildStatus =
  | 'READY'
  | 'NO_DATA'
  | 'INSUFFICIENT_POINTS'
  | 'COLLINEAR_POINTS'
  | 'OUTSIDE_ZONE'
  | 'INVALID_INPUT';

export interface SkippedRssiGroup {
  surveyId: string | null;
  bssid: string;
  band: Band;
  frequencyMHz: number | null;
  status: Exclude<RssiMeshBuildStatus, 'READY' | 'NO_DATA'>;
  droppedCount: number;
  /** Zone ayant conduit à l'écart, si le maillage est contraint. */
  polygonId?: string | null;
}

export interface RssiMeshBuildResult {
  status: RssiMeshBuildStatus;
  /** Un maillage par couple BSSID + survey + bande + fréquence (+ zone). */
  meshes: InterpolationMesh[];
  skipped: SkippedRssiGroup[];
  /** Lignes lues depuis l'API avant regroupement. */
  rowCount: number;
  /** Lignes ignorées car leur bande n'est pas reconnue. */
  ignoredRowCount: number;
}

/** Zone autorisée pour la heatmap. Aucun sommet ne porte de RSSI. */
export interface RssiPolygonConstraint {
  id: string;
  vertices: readonly NormalizedCoord[];
}

export interface RssiMeshBuildOptions {
  /**
   * Zones de délimitation. Si la liste est non vide, chaque zone est
   * triangulée séparément avec ses seules mesures intérieures, puis les
   * triangles ne sont conservés que s'ils sont entièrement contenus dans la
   * zone. Sans polygone, le maillage global historique est conservé.
   */
  polygons?: readonly RssiPolygonConstraint[];
}

interface RowGroup {
  key: string;
  surveyId: string | null;
  bssid: string;
  band: Band;
  frequencyMHz: number | null;
  measurements: RssiMeasurement[];
}

interface PreparedConstraint {
  id: string;
  pixels: PlanPixelPoint[];
}

function toBand(value: unknown): Band | null {
  if (value === '2.4GHz' || value === '5GHz' || value === '6GHz') return value;
  return null;
}

function groupKey(
  surveyId: string | null,
  bssid: string,
  band: Band,
  frequencyMHz: number | null
): string {
  return `${surveyId ?? ''}|${bssid}|${band}|${frequencyMHz ?? ''}`;
}

/**
 * Ne garde que les polygones exploitables. Un polygone invalide ou
 * auto-intersecté est ignoré : mieux vaut ne rien afficher que de colorier une
 * zone dont la géométrie est ambiguë.
 *
 * Le critère est celui de `buildZoneMask`, le même que pour le masque IDW :
 * les couches RSSI et débit ne peuvent donc pas diverger sur une zone.
 */
function prepareConstraints(
  polygons: readonly RssiPolygonConstraint[],
  plan: PlanReference,
): PreparedConstraint[] {
  const constraints: PreparedConstraint[] = [];
  for (const polygon of polygons) {
    if (!polygon || typeof polygon.id !== 'string' || polygon.id === '') continue;
    const vertices: readonly NormalizedCoord[] = Array.isArray(polygon.vertices)
      ? polygon.vertices
      : [];
    const mask = buildZoneMask(vertices, plan.width, plan.height);
    if (!mask) continue;
    constraints.push({ id: polygon.id, pixels: mask.pixels });
  }
  return constraints;
}

function scopeFor(group: RowGroup, plan: PlanReference) {
  return {
    planId: plan.id,
    surveyId: group.surveyId,
    bssid: group.bssid,
    frequency_mhz: group.frequencyMHz,
    band: group.band,
  };
}

function skippedFromResult(
  group: RowGroup,
  result: Exclude<TriangulationResult, { status: 'READY' }>,
  polygonId: string | null,
): SkippedRssiGroup {
  return {
    surveyId: group.surveyId,
    bssid: group.bssid,
    band: group.band,
    frequencyMHz: group.frequencyMHz,
    status: result.status,
    droppedCount:
      result.status === 'INVALID_INPUT'
        ? result.issues.length
        : result.dropped.length,
    polygonId,
  };
}

/**
 * Transforme les lignes de `/heatmap` en maillages Delaunay séparés.
 *
 * Le backend renvoie déjà le meilleur RSSI par point et par BSSID. On conserve
 * cette granularité et on regroupe aussi par survey, bande et fréquence pour
 * ne jamais interpoler entre deux périmètres différents. Les groupes qui ne
 * produisent pas de triangle sont ignorés ; leurs mesures restent visibles via
 * les marqueurs de la carte.
 *
 * Quand des polygones sont fournis, le traitement devient indépendant par
 * zone : seules les mesures situées dans la zone alimentent sa triangulation,
 * et un triangle n'est gardé que si toute sa surface est dans le polygone.
 * Les sommets des polygones ne sont jamais utilisés comme points de mesure.
 */
export function buildRssiMeshes(
  rows: HeatmapRow[],
  plan: PlanReference,
  options: RssiMeshBuildOptions = {}
): RssiMeshBuildResult {
  // Dès qu'une zone est demandée, on ne retombe jamais sur le maillage global :
  // une zone invalide ne doit pas ouvrir toute la heatmap par accident.
  const constrained = (options.polygons?.length ?? 0) > 0;
  const constraints = constrained
    ? prepareConstraints(options.polygons ?? [], plan)
    : [];
  const groups = new Map<string, RowGroup>();
  let ignoredRowCount = 0;

  for (const row of rows) {
    if (row.plan_id !== plan.id) {
      ignoredRowCount += 1;
      continue;
    }

    const band = toBand(row.band);
    if (band === null) {
      ignoredRowCount += 1;
      continue;
    }

    const surveyId = row.survey_id ?? null;
    const bssid = row.bssid.trim().toLowerCase();
    const frequencyMHz =
      typeof row.frequency_mhz === 'number' ? row.frequency_mhz : null;
    const key = groupKey(surveyId, bssid, band, frequencyMHz);

    let group = groups.get(key);
    if (group === undefined) {
      group = { key, surveyId, bssid, band, frequencyMHz, measurements: [] };
      groups.set(key, group);
    }

    group.measurements.push({
      scan_point_id: row.scan_point_id,
      planId: plan.id,
      surveyId,
      bssid,
      frequency_mhz: frequencyMHz,
      band,
      x: row.x,
      y: row.y,
      rssi: row.rssi,
    });
  }

  const meshes: InterpolationMesh[] = [];
  const skipped: SkippedRssiGroup[] = [];

  for (const group of groups.values()) {
    if (!constrained) {
      const result = triangulateRssi({
        scope: scopeFor(group, plan),
        plan,
        measurements: group.measurements,
      });
      if (result.status === 'READY') {
        meshes.push(result.mesh);
      } else {
        skipped.push(skippedFromResult(group, result, null));
      }
      continue;
    }

    for (const constraint of constraints) {
      const measurementsInZone = group.measurements.filter((measurement) =>
        pointInPolygonPx(
          measurement.x * plan.width,
          measurement.y * plan.height,
          constraint.pixels,
        )
      );

      const result = triangulateRssi({
        scope: scopeFor(group, plan),
        plan,
        measurements: measurementsInZone,
      });

      if (result.status !== 'READY') {
        skipped.push(skippedFromResult(group, result, constraint.id));
        continue;
      }

      const triangles = result.mesh.triangles.filter((triangle) =>
        triangleInsidePolygonPx(
          triangle.a,
          triangle.b,
          triangle.c,
          constraint.pixels,
        )
      );

      if (triangles.length === 0) {
        skipped.push({
          surveyId: group.surveyId,
          bssid: group.bssid,
          band: group.band,
          frequencyMHz: group.frequencyMHz,
          status: 'OUTSIDE_ZONE',
          droppedCount: result.mesh.triangles.length,
          polygonId: constraint.id,
        });
        continue;
      }

      meshes.push({
        ...result.mesh,
        polygonId: constraint.id,
        triangles,
      });
    }
  }

  let status: RssiMeshBuildStatus;
  if (meshes.length > 0) {
    status = 'READY';
  } else if (ignoredRowCount > 0 || skipped.some((group) => group.status === 'INVALID_INPUT')) {
    status = 'INVALID_INPUT';
  } else if (skipped.some((group) => group.status === 'COLLINEAR_POINTS')) {
    status = 'COLLINEAR_POINTS';
  } else if (skipped.some((group) => group.status === 'OUTSIDE_ZONE')) {
    status = 'OUTSIDE_ZONE';
  } else if (skipped.length > 0) {
    status = 'INSUFFICIENT_POINTS';
  } else {
    status = 'NO_DATA';
  }

  return {
    status,
    meshes,
    skipped,
    rowCount: rows.length,
    ignoredRowCount,
  };
}

/* ==========================================================================
   Retour utilisateur : zones présentes mais non maillées
   ========================================================================== */

export interface UncoveredZone {
  /** Identifiant de la zone telle que renvoyée par l'API. */
  id: string;
  /** Position dans la liste fournie (1-indexé), pour l'affichage. */
  zoneNumber: number;
  /** Formulation courte, sans jargon, à afficher à l'utilisateur. */
  reason: string;
}

function uncoveredReason(status: RssiMeshBuildStatus | undefined): string {
  switch (status) {
    case 'OUTSIDE_ZONE':
      return 'aucun triangle entièrement dans la zone';
    case 'COLLINEAR_POINTS':
      return 'mesures alignées, triangulation impossible';
    case 'INVALID_INPUT':
      return 'mesures invalides';
    default:
      return 'pas assez de mesures valides';
  }
}

/**
 * Liste les zones pour lesquelles aucun triangle n'a pu être construit.
 *
 * Retourne une liste vide dès que rien n'est à signaler (aucune zone, plan
 * sans mesure, toutes les zones maillées) : l'appelant n'affiche alors aucun
 * message, pour ne jamais émettre d'alerte quand tout fonctionne.
 */
export function findUncoveredZones(
  result: RssiMeshBuildResult,
  polygons: readonly RssiPolygonConstraint[],
  plan: PlanReference
): UncoveredZone[] {
  if (result.rowCount === 0 || polygons.length === 0) return [];

  const uncovered: UncoveredZone[] = [];
  polygons.forEach((polygon, index) => {
    const covered = result.meshes.some((mesh) => mesh.polygonId === polygon.id);
    if (covered) return;

    const skipped = result.skipped.find((entry) => entry.polygonId === polygon.id);
    const status =
      skipped?.status ?? (result.status !== 'READY' ? result.status : undefined);
    const geometryValid =
      buildZoneMask(polygon.vertices, plan.width, plan.height) !== null;

    uncovered.push({
      id: polygon.id,
      zoneNumber: index + 1,
      reason: geometryValid ? uncoveredReason(status) : 'géométrie de zone invalide',
    });
  });
  return uncovered;
}
