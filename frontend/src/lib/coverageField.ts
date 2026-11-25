import { normalizedToPlanPixel, type NormalizedCoord } from './coords.js';
import { buildZoneMask, GEOMETRY_EPSILON_PX, pointInPolygonPx, type ZoneMask } from './polygon.js';
import {
  combineHybridFields,
  createHybridField,
  EXTRAP_PENALTY_DB,
  type HybridField,
  type HybridSample,
} from './rssiHybridField.js';
import { sampleTriangleMesh, type InterpolationMesh } from './triangulation.js';

type Ap = { bssid: string; x: number; y: number };
type AccessPoint = { id: string; x: number; y: number; bssids?: string[] };
type Zone = { id: string; vertices: readonly NormalizedCoord[] };

interface ZonedField {
  field: HybridField;
  /** Index dans `masks`. */
  maskIndex: number;
}

type DataSample = Exclude<HybridSample, { status: 'NO_DATA' }>;

function sampleScore(sample: DataSample): number {
  return sample.status === 'INTERPOLATED'
    ? sample.rssi
    : sample.rssi - EXTRAP_PENALTY_DB * (1 - sample.confidence);
}

/**
 * Combine des champs dont plusieurs partagent la même zone. Le test
 * d'appartenance est mémoïsé pour la durée d'un pixel : dix BSSID d'une même
 * zone ne parcourent plus dix fois le polygone.
 */
function combineZonedFields(
  entries: readonly ZonedField[],
  masks: readonly ZoneMask[],
): HybridField {
  const maskGenerations = new Uint32Array(masks.length);
  const maskInside = new Uint8Array(masks.length);
  let generation = 0;

  return {
    model: null,
    sample(xPx: number, yPx: number): HybridSample {
      generation += 1;
      if (generation > 0xffffffff) {
        maskGenerations.fill(0);
        generation = 1;
      }

      let best: HybridSample | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const entry of entries) {
        const mask = masks[entry.maskIndex];
        if (maskGenerations[entry.maskIndex] !== generation) {
          maskGenerations[entry.maskIndex] = generation;
          if (
            xPx < mask.minX - GEOMETRY_EPSILON_PX ||
            xPx > mask.maxX + GEOMETRY_EPSILON_PX ||
            yPx < mask.minY - GEOMETRY_EPSILON_PX ||
            yPx > mask.maxY + GEOMETRY_EPSILON_PX
          ) {
            maskInside[entry.maskIndex] = 0;
          } else {
            maskInside[entry.maskIndex] = pointInPolygonPx(xPx, yPx, mask.pixels) ? 1 : 0;
          }
        }
        if (maskInside[entry.maskIndex] === 0) continue;

        const sample = entry.field.sample(xPx, yPx);
        if (sample.status === 'NO_DATA') continue;
        const score = sampleScore(sample);
        if (best === null || score > bestScore) {
          best = sample;
          bestScore = score;
        }
      }
      return best ?? { status: 'NO_DATA', rssi: null };
    },
  };
}

/** Champ commun au rendu et à la sonde. Chaque maillage reste dans sa zone. */
export function buildCoverageField(
  meshes: readonly InterpolationMesh[],
  polygons: readonly Zone[],
  apPositions: readonly Ap[],
  accessPoints: readonly AccessPoint[],
): HybridField {
  const buildField = (mesh: InterpolationMesh): HybridField => {
    const source = {
      bssid: mesh.scope.bssid,
      band: mesh.scope.band,
      surveyId: mesh.scope.surveyId,
    };
    if (polygons.length === 0) {
      return {
        model: null,
        sample(x, y) {
          const sample = sampleTriangleMesh(mesh, x, y);
          return sample.status === 'INTERPOLATED'
            ? { status: 'INTERPOLATED', rssi: sample.rssi, confidence: 1, source }
            : { status: 'NO_DATA', rssi: null };
        },
      };
    }

    const bssid = mesh.scope.bssid.trim().toLowerCase();
    const position = apPositions.find((ap) => ap.bssid.trim().toLowerCase() === bssid)
      ?? accessPoints.find((ap) => ap.bssids?.some((b) => b.trim().toLowerCase() === bssid));
    const ap = position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? normalizedToPlanPixel(position.x, position.y, mesh.width, mesh.height)
      : null;
    return createHybridField(mesh, { ap });
  };

  if (polygons.length === 0) {
    return combineHybridFields(meshes.map(buildField));
  }

  const zoneById = new Map<string, Zone>();
  for (const polygon of polygons) {
    if (!zoneById.has(polygon.id)) zoneById.set(polygon.id, polygon);
  }
  const maskIndexByGeometry = new Map<string, number | null>();
  const masks: ZoneMask[] = [];
  const entries: ZonedField[] = [];

  for (const mesh of meshes) {
    const zone = mesh.polygonId == null ? undefined : zoneById.get(mesh.polygonId);
    if (!zone) continue;

    const key = JSON.stringify([zone.id, mesh.width, mesh.height]);
    let maskIndex = maskIndexByGeometry.get(key);
    if (maskIndex === undefined) {
      const mask = buildZoneMask(zone.vertices, mesh.width, mesh.height);
      maskIndex = mask ? masks.push(mask) - 1 : null;
      maskIndexByGeometry.set(key, maskIndex);
    }
    if (maskIndex === null) continue;
    entries.push({ field: buildField(mesh), maskIndex });
  }

  return combineZonedFields(entries, masks);
}
