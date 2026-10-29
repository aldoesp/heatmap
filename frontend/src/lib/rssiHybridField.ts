import type { InterpolationMesh, GeometryPoint } from './triangulation.js';
import { sampleTriangleMesh, medianNearestNeighborDistancePx } from './triangulation.js';
import type { ApPosition, PathLossModel } from './pathLossModel.js';
import {
  fitPathLossModel,
  predictPathLossRaw,
  clampRssi,
  computeResiduals,
} from './pathLossModel.js';

export type HybridSample =
  | { status: 'INTERPOLATED'; rssi: number; confidence: number }
  | { status: 'EXTRAPOLATED'; rssi: number; confidence: number }
  | { status: 'NO_DATA'; rssi: null };

export interface HybridField {
  sample(xPx: number, yPx: number): HybridSample;
  model: PathLossModel | null;
}

export function createHybridField(
  mesh: InterpolationMesh,
  options: { ap: ApPosition | null; decayFactor?: number; idwNeighbors?: number }
): HybridField {
  const decayFactor = options.decayFactor ?? 3;
  const idwNeighbors = options.idwNeighbors ?? 3;

  const model =
    options.ap === null
      ? null
      : fitPathLossModel(mesh.points, options.ap, { width: mesh.width, height: mesh.height });

  const residuals = model ? computeResiduals(mesh.points, model) : null;

  const triangleById = new Map<string, { a: GeometryPoint; b: GeometryPoint; c: GeometryPoint }>();
  for (const t of mesh.triangles) {
    triangleById.set(t.id, { a: t.a, b: t.b, c: t.c });
  }

  const Lraw = medianNearestNeighborDistancePx(mesh.points) * decayFactor;
  const L = Lraw === 0 ? 1 : Lraw;

  function sample(xPx: number, yPx: number): HybridSample {
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) {
      return { status: 'NO_DATA', rssi: null };
    }

    const meshSample = sampleTriangleMesh(mesh, xPx, yPx);

    if (model === null || residuals === null) {
      if (meshSample.status === 'INTERPOLATED') {
        return { status: 'INTERPOLATED', rssi: meshSample.rssi, confidence: 1 };
      }
      return { status: 'NO_DATA', rssi: null };
    }

    if (meshSample.status === 'INTERPOLATED' && meshSample.supported) {
      const tri = triangleById.get(meshSample.triangleId);
      if (tri) {
        const rA = residuals.get(tri.a.sourceId) ?? 0;
        const rB = residuals.get(tri.b.sourceId) ?? 0;
        const rC = residuals.get(tri.c.sourceId) ?? 0;
        const residual = meshSample.lambdaA * rA + meshSample.lambdaB * rB + meshSample.lambdaC * rC;
        const rssi = clampRssi(predictPathLossRaw(model, xPx, yPx) + residual);
        return { status: 'INTERPOLATED', rssi, confidence: 1 };
      }
    }

    // EXTRAPOLATED
    let dMin = Infinity;
    const sorted = mesh.points
      .map((p) => ({ p, d: Math.hypot(p.xPx - xPx, p.yPx - yPx) }))
      .sort((a, b) => a.d - b.d);
    const k = Math.min(idwNeighbors, sorted.length);
    const neighbors = sorted.slice(0, k);
    for (const n of neighbors) {
      if (n.d < dMin) dMin = n.d;
    }
    if (neighbors.length === 0) {
      return { status: 'NO_DATA', rssi: null };
    }

    let wSum = 0;
    let rSum = 0;
    for (const n of neighbors) {
      const w = 1 / (n.d * n.d + 1e-6);
      const r = residuals.get(n.p.sourceId) ?? 0;
      wSum += w;
      rSum += w * r;
    }
    const residAvg = wSum > 0 ? rSum / wSum : 0;
    const confidence = Math.exp(-dMin / L);
    const residual = residAvg * confidence;
    const rssi = clampRssi(predictPathLossRaw(model, xPx, yPx) + residual);
    return { status: 'EXTRAPOLATED', rssi, confidence };
  }

  return { sample, model };
}
