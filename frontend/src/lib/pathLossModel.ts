import type { GeometryPoint } from './triangulation.js';

export interface ApPosition {
  xPx: number;
  yPx: number;
}

export interface PathLossModel {
  ap: ApPosition;
  aDbm: number;
  n: number;
  minDistancePx: number;
  sampleCount: number;
  rmse: number;
  nSource: 'fitted' | 'default' | 'clamped';
}

export function clampRssi(value: number): number {
  return Math.max(-127, Math.min(0, value));
}

export function fitPathLossModel(
  points: GeometryPoint[],
  ap: ApPosition,
  plan: { width: number; height: number }
): PathLossModel | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  if (!Number.isFinite(ap.xPx) || !Number.isFinite(ap.yPx)) return null;

  const minDistancePx = 0.02 * Math.max(plan.width, plan.height);

  const xs: number[] = [];
  const rs: number[] = [];
  for (const p of points) {
    const dx = p.xPx - ap.xPx;
    const dy = p.yPx - ap.yPx;
    const d = Math.max(Math.hypot(dx, dy), minDistancePx);
    xs.push(Math.log10(d));
    rs.push(p.rssi);
  }

  const nPoints = xs.length;
  let n = 3.0;
  let nSource: PathLossModel['nSource'] = 'default';
  let aDbm: number;

  const meanX = xs.reduce((s, v) => s + v, 0) / nPoints;
  const meanR = rs.reduce((s, v) => s + v, 0) / nPoints;
  const varX = xs.reduce((s, v) => s + (v - meanX) ** 2, 0);

  if (nPoints >= 5 && varX >= 1e-9) {
    const covXR = xs.reduce((s, v, i) => s + (v - meanX) * (rs[i] - meanR), 0);
    const slope = covXR / varX;
    const nFitted = -slope / 10;
    if (Number.isFinite(nFitted)) {
      n = nFitted;
      nSource = 'fitted';
    }
  }

  if (nSource === 'default') {
    aDbm = rs.reduce((s, v, i) => s + (v + 10 * n * xs[i]), 0) / nPoints;
  } else {
    if (n < 1.5 || n > 4.5) {
      n = Math.max(1.5, Math.min(4.5, n));
      nSource = 'clamped';
    }
    aDbm = meanR + 10 * n * meanX;
  }

  // Recompute aDbm consistently for fitted/clamped via least squares intercept
  if (nSource !== 'default') {
    aDbm = meanR + 10 * n * meanX;
  }

  // rmse
  let sse = 0;
  for (let i = 0; i < nPoints; i += 1) {
    const pred = aDbm - 10 * n * xs[i];
    sse += (rs[i] - pred) ** 2;
  }
  const rmse = Math.sqrt(sse / nPoints);

  return {
    ap: { xPx: ap.xPx, yPx: ap.yPx },
    aDbm,
    n,
    minDistancePx,
    sampleCount: nPoints,
    rmse,
    nSource,
  };
}

export function predictPathLossRaw(model: PathLossModel, xPx: number, yPx: number): number {
  const dx = xPx - model.ap.xPx;
  const dy = yPx - model.ap.yPx;
  const d = Math.max(Math.hypot(dx, dy), model.minDistancePx);
  return model.aDbm - 10 * model.n * Math.log10(d);
}

export function computeResiduals(points: GeometryPoint[], model: PathLossModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    out.set(p.sourceId, p.rssi - predictPathLossRaw(model, p.xPx, p.yPx));
  }
  return out;
}
