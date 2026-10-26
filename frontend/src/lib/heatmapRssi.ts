import type { HeatmapRow } from '../types/api.js';
import {
  triangulateRssi,
  type Band,
  type InterpolationMesh,
  type PlanReference,
  type RssiMeasurement,
} from './triangulation.js';

export type RssiMeshBuildStatus =
  | 'READY'
  | 'NO_DATA'
  | 'INSUFFICIENT_POINTS'
  | 'COLLINEAR_POINTS'
  | 'INVALID_INPUT';

export interface SkippedRssiGroup {
  surveyId: string | null;
  bssid: string;
  band: Band;
  frequencyMHz: number | null;
  status: Exclude<RssiMeshBuildStatus, 'READY' | 'NO_DATA'>;
  droppedCount: number;
}

export interface RssiMeshBuildResult {
  status: RssiMeshBuildStatus;
  /** Un maillage par couple BSSID + survey + bande + fréquence. */
  meshes: InterpolationMesh[];
  skipped: SkippedRssiGroup[];
  /** Lignes lues depuis l'API avant regroupement. */
  rowCount: number;
  /** Lignes ignorées car leur bande n'est pas reconnue. */
  ignoredRowCount: number;
}

interface RowGroup {
  key: string;
  surveyId: string | null;
  bssid: string;
  band: Band;
  frequencyMHz: number | null;
  measurements: RssiMeasurement[];
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
 * Transforme les lignes de `/heatmap` en maillages Delaunay séparés.
 *
 * Le backend renvoie déjà le meilleur RSSI par point et par BSSID. On conserve
 * cette granularité et on regroupe aussi par survey, bande et fréquence pour
 * ne jamais interpoler entre deux périmètres différents. Les groupes qui ne
 * produisent pas de triangle sont ignorés ; leurs mesures restent visibles via
 * les marqueurs de la carte.
 */
export function buildRssiMeshes(
  rows: HeatmapRow[],
  plan: PlanReference
): RssiMeshBuildResult {
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
    const result = triangulateRssi({
      scope: {
        planId: plan.id,
        surveyId: group.surveyId,
        bssid: group.bssid,
        frequency_mhz: group.frequencyMHz,
        band: group.band,
      },
      plan,
      measurements: group.measurements,
    });

    if (result.status === 'READY') {
      meshes.push(result.mesh);
      continue;
    }

    skipped.push({
      surveyId: group.surveyId,
      bssid: group.bssid,
      band: group.band,
      frequencyMHz: group.frequencyMHz,
      status: result.status,
      droppedCount: result.status === 'INVALID_INPUT' ? result.issues.length : result.dropped.length,
    });
  }

  let status: RssiMeshBuildStatus;
  if (meshes.length > 0) {
    status = 'READY';
  } else if (ignoredRowCount > 0 || skipped.some((group) => group.status === 'INVALID_INPUT')) {
    status = 'INVALID_INPUT';
  } else if (skipped.some((group) => group.status === 'COLLINEAR_POINTS')) {
    status = 'COLLINEAR_POINTS';
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
