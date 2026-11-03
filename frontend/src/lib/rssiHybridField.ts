import type { InterpolationMesh, GeometryPoint } from './triangulation.js';
import {
  sampleTriangleMesh,
  medianNearestNeighborDistancePx,
  findBorderTriangles,
  prepareBarycentricTriangle,
  barycentricWeightsUnclamped,
  distanceToTrianglePx,
  type PreparedBarycentricTriangle,
} from './triangulation.js';
import type { ApPosition, PathLossModel } from './pathLossModel.js';
import {
  fitPathLossModel,
  predictPathLossRaw,
  clampRssi,
  computeResiduals,
} from './pathLossModel.js';

export const EXTRAP_PENALTY_DB = 12;

export type HybridSample =
  | { status: 'INTERPOLATED'; rssi: number; confidence: number; source?: { bssid: string; band: string; surveyId: string | null } }
  | { status: 'EXTRAPOLATED'; rssi: number; confidence: number; source?: { bssid: string; band: string; surveyId: string | null } }
  | { status: 'NO_DATA'; rssi: null };

export interface HybridField {
  sample(xPx: number, yPx: number): HybridSample;
  model: PathLossModel | null;
}

type ReadyTriangle = Extract<PreparedBarycentricTriangle, { status: 'READY' }>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function combineHybridFields(fields: HybridField[]): HybridField {
  return {
    model: null,
    sample(xPx: number, yPx: number): HybridSample {
      let best: HybridSample | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const field of fields) {
        const sample = field.sample(xPx, yPx);
        if (sample.status === 'NO_DATA') continue;
        const score =
          sample.status === 'INTERPOLATED'
            ? sample.rssi
            : sample.rssi - EXTRAP_PENALTY_DB * (1 - sample.confidence);
        if (best === null || score > bestScore) {
          best = sample;
          bestScore = score;
        }
      }
      return best ?? { status: 'NO_DATA', rssi: null };
    },
  };
}

export function createHybridField(
  mesh: InterpolationMesh,
  options: { ap: ApPosition | null; decayFactor?: number }
): HybridField {
  const decayFactor = options.decayFactor ?? 3;

  const model =
    options.ap === null
      ? null
      : fitPathLossModel(mesh.points, options.ap, { width: mesh.width, height: mesh.height });

  const residuals = model ? computeResiduals(mesh.points, model) : null;

  const source = { bssid: mesh.scope.bssid, band: mesh.scope.band, surveyId: mesh.scope.surveyId };

  const triangleById = new Map<string, { a: GeometryPoint; b: GeometryPoint; c: GeometryPoint }>();
  for (const t of mesh.triangles) {
    triangleById.set(t.id, { a: t.a, b: t.b, c: t.c });
  }

  const borderTriangles: ReadyTriangle[] = [];
  for (const triangle of findBorderTriangles(mesh.triangles)) {
    const prepared = prepareBarycentricTriangle(triangle);
    if (prepared.status === 'READY') borderTriangles.push(prepared);
  }

  let vMin = Infinity;
  let vMax = -Infinity;
  if (model !== null && residuals !== null) {
    for (const value of residuals.values()) {
      if (value < vMin) vMin = value;
      if (value > vMax) vMax = value;
    }
  } else {
    for (const point of mesh.points) {
      if (point.rssi < vMin) vMin = point.rssi;
      if (point.rssi > vMax) vMax = point.rssi;
    }
  }
  if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) {
    vMin = 0;
    vMax = 0;
  }

  const Lraw = medianNearestNeighborDistancePx(mesh.points) * decayFactor;
  const L = Lraw === 0 ? 1 : Lraw;

  function sample(xPx: number, yPx: number): HybridSample {
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) {
      return { status: 'NO_DATA', rssi: null };
    }

    const meshSample = sampleTriangleMesh(mesh, xPx, yPx);

    if (meshSample.status === 'INTERPOLATED' && meshSample.supported) {
      if (model !== null && residuals !== null) {
        const tri = triangleById.get(meshSample.triangleId);
        if (tri) {
          const rA = residuals.get(tri.a.sourceId) ?? 0;
          const rB = residuals.get(tri.b.sourceId) ?? 0;
          const rC = residuals.get(tri.c.sourceId) ?? 0;
          const residual = meshSample.lambdaA * rA + meshSample.lambdaB * rB + meshSample.lambdaC * rC;
          const rssi = clampRssi(predictPathLossRaw(model, xPx, yPx) + residual);
          return { status: 'INTERPOLATED', rssi, confidence: 1, source };
        }
      } else {
        return { status: 'INTERPOLATED', rssi: meshSample.rssi, confidence: 1, source };
      }
    }

    let candidates = borderTriangles;
    if (meshSample.status === 'INTERPOLATED' && !meshSample.supported) {
      const tri = triangleById.get(meshSample.triangleId);
      const prepared = tri ? prepareBarycentricTriangle(tri) : null;
      candidates = prepared !== null && prepared.status === 'READY' ? [prepared] : [];
    }
    if (candidates.length === 0) {
      return { status: 'NO_DATA', rssi: null };
    }

    let best: ReadyTriangle | null = null;
    let dMin = Infinity;
    for (const candidate of candidates) {
      const distance = distanceToTrianglePx(
        xPx,
        yPx,
        candidate.a,
        candidate.b,
        candidate.c
      );
      if (distance < dMin) {
        dMin = distance;
        best = candidate;
      }
    }
    if (best === null) {
      return { status: 'NO_DATA', rssi: null };
    }

    const weights = barycentricWeightsUnclamped(xPx, yPx, best);
    if (weights === null) {
      return { status: 'NO_DATA', rssi: null };
    }
    const [wa, wb, wc] = weights;

    let v: number;
    if (model !== null && residuals !== null) {
      const rA = residuals.get(best.a.sourceId) ?? 0;
      const rB = residuals.get(best.b.sourceId) ?? 0;
      const rC = residuals.get(best.c.sourceId) ?? 0;
      v = wa * rA + wb * rB + wc * rC;
      v = clamp(v, vMin, vMax);
      const rssi = clampRssi(predictPathLossRaw(model, xPx, yPx) + v);
      return { status: 'EXTRAPOLATED', rssi, confidence: Math.exp(-dMin / L), source };
    }

    v = wa * best.a.rssi + wb * best.b.rssi + wc * best.c.rssi;
    v = clamp(v, vMin, vMax);
    return {
      status: 'EXTRAPOLATED',
      rssi: clampRssi(v),
      confidence: Math.exp(-dMin / L),
      source,
    };
  }

  return { sample, model };
}
