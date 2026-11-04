import { normalizedToPlanPixel, type NormalizedCoord } from './coords.js';
import { buildZoneMask, pointInPolygonPx } from './polygon.js';
import { combineHybridFields, createHybridField, type HybridField } from './rssiHybridField.js';
import { sampleTriangleMesh, type InterpolationMesh } from './triangulation.js';

type Ap = { bssid: string; x: number; y: number };
type AccessPoint = { id: string; x: number; y: number; bssids?: string[] };
type Zone = { id: string; vertices: readonly NormalizedCoord[] };

/** Champ commun au rendu et à la sonde. Chaque maillage reste dans sa zone. */
export function buildCoverageField(
  meshes: readonly InterpolationMesh[],
  polygons: readonly Zone[],
  apPositions: readonly Ap[],
  accessPoints: readonly AccessPoint[],
): HybridField {
  const fields = meshes.map((mesh): HybridField => {
    const source = { bssid: mesh.scope.bssid, band: mesh.scope.band, surveyId: mesh.scope.surveyId };
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
    const field = createHybridField(mesh, { ap });
    const zone = polygons.find((polygon) => polygon.id === mesh.polygonId);
    const mask = zone ? buildZoneMask(zone.vertices, mesh.width, mesh.height) : null;
    return {
      model: field.model,
      sample(x, y) {
        return mask && pointInPolygonPx(x, y, mask.pixels)
          ? field.sample(x, y)
          : { status: 'NO_DATA', rssi: null };
      },
    };
  });
  return combineHybridFields(fields);
}
