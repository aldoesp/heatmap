import type { HeatmapRow } from '../types/api.js';
import { buildZoneMask, pointInPolygonPx, type ZoneMask } from './polygon.js';
import { buildRssiMeshes, type RssiPolygonConstraint } from './heatmapRssi.js';
import { sampleTriangleMesh, type InterpolationMesh, type PlanReference } from './triangulation.js';
import type { HybridField, HybridSample } from './rssiHybridField.js';

export type RssiCalculation = 'hybrid' | 'regularized';
type Node = { x: number; y: number; value: number };
type Zone = { id: string | null; mask: ZoneMask | null; nodes: Map<string, Node> };
const empty = (): HybridSample => ({ status: 'NO_DATA', rssi: null });
const kernel = (r: number) => r > 0 ? r * r * Math.log(r) : 0;
const median = (values: number[]) => quantile(values, .5);
function quantile(values: number[], q: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return 0;
  const index = (ordered.length - 1) * q, lo = Math.floor(index), hi = Math.ceil(index);
  return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo);
}

/** Pivoting avoids relying on the point order; singular systems use IDW. */
function solve(matrix: number[][], right: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, right[i]]), n = a.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  const result = a.map(row => row[n]);
  return result.every(Number.isFinite) ? result : null;
}

/** Thin-plate spline with affine tail, same normalization as the comparison. */
export function fitRegularizedRssi(nodes: readonly Node[], scale: number, smoothing = 1): (x: number, y: number) => number | null {
  if (!nodes.length || !(scale > 0) || !Number.isFinite(smoothing) || smoothing < 0) return () => null;
  const n = nodes.length;
  const x = nodes.map(p => p.x / scale), y = nodes.map(p => p.y / scale);
  const lo = Math.min(...nodes.map(p => p.value)), hi = Math.max(...nodes.map(p => p.value));
  let coefficients: number[] | null = null;
  if (n >= 3) {
    const matrix = Array.from({ length: n + 3 }, () => Array<number>(n + 3).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) matrix[i][j] = kernel(Math.hypot(x[i] - x[j], y[i] - y[j])) + (i === j ? smoothing : 0);
      matrix[i][n] = matrix[n][i] = 1;
      matrix[i][n + 1] = matrix[n + 1][i] = x[i];
      matrix[i][n + 2] = matrix[n + 2][i] = y[i];
    }
    coefficients = solve(matrix, [...nodes.map(p => p.value), 0, 0, 0]);
  }
  return (px, py) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    let value: number;
    if (coefficients) {
      value = coefficients[n] + coefficients[n + 1] * px / scale + coefficients[n + 2] * py / scale;
      for (let i = 0; i < n; i++) value += coefficients[i] * kernel(Math.hypot(px / scale - x[i], py / scale - y[i]));
    } else {
      // Sparse/collinear data: local IDW, still bounded by the field's radius.
      const nearest = nodes.map(p => ({ value: p.value, distance: Math.hypot(px - p.x, py - p.y) })).sort((a, b) => a.distance - b.distance).slice(0, 4);
      if (nearest[0].distance < 1e-6) return nearest[0].value;
      let sum = 0, weights = 0;
      for (const point of nearest) { const w = 1 / Math.max(point.distance, 1e-6) ** 2; sum += point.value * w; weights += w; }
      value = sum / weights;
    }
    return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : null;
  };
}

const scopeKey = (survey: string | null, bssid: string, band: string, frequency: number | null, zone: string | null) => JSON.stringify([survey, bssid, band, frequency, zone]);

/** Each radio/zone is fitted separately; positions of APs are not assumed. */
export function buildRegularizedRssiField(
  rows: readonly HeatmapRow[], plan: PlanReference,
  polygons: readonly RssiPolygonConstraint[] = [],
  meshes?: readonly InterpolationMesh[],
  smoothing = 1,
): HybridField {
  if (!(plan.width > 0) || !(plan.height > 0)) return { model: null, sample: empty };
  const zones: Zone[] = polygons.length ? polygons.flatMap(p => {
    const mask = buildZoneMask(p.vertices, plan.width, plan.height);
    return mask ? [{ id: p.id, mask, nodes: new Map<string, Node>() }] : [];
  }) : [{ id: null, mask: null, nodes: new Map<string, Node>() }];
  const inside = (z: Zone, x: number, y: number) => z.mask ? pointInPolygonPx(x, y, z.mask.pixels) : x >= 0 && x <= plan.width && y >= 0 && y <= plan.height;
  const groups = new Map<string, { zone: Zone; samples: Map<string, { x: number; y: number; values: number[] }>; source: { bssid: string; band: string; surveyId: string | null } }>();
  for (const row of rows) {
    if (row.plan_id !== plan.id || !Number.isFinite(row.rssi) || row.rssi < -127 || row.rssi > 0 || !Number.isFinite(row.x) || !Number.isFinite(row.y) || row.x < 0 || row.x > 1 || row.y < 0 || row.y > 1 || !row.bssid?.trim() || !['2.4GHz', '5GHz', '6GHz'].includes(row.band)) continue;
    const x = row.x * plan.width, y = row.y * plan.height, position = `${x}|${y}`;
    for (const zone of zones) {
      if (!inside(zone, x, y)) continue;
      zone.nodes.set(position, { x, y, value: row.rssi });
      const bssid = row.bssid.trim().toLowerCase(), key = scopeKey(row.survey_id ?? null, bssid, row.band, row.frequency_mhz ?? null, zone.id);
      let group = groups.get(key);
      if (!group) { group = { zone, samples: new Map(), source: { bssid, band: row.band, surveyId: row.survey_id ?? null } }; groups.set(key, group); }
      const existing = group.samples.get(position);
      if (existing) existing.values.push(row.rssi); else group.samples.set(position, { x, y, values: [row.rssi] });
    }
  }
  const radii = new Map<Zone, number>();
  for (const zone of zones) {
    const points = [...zone.nodes.values()];
    const distances = points.map((p, i) => Math.min(...points.filter((_, j) => i !== j).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
    radii.set(zone, points.length > 1 ? quantile(distances, .9) : Math.max(1, Math.min(plan.width, plan.height) * .02));
  }
  const geometry = meshes ?? buildRssiMeshes([...rows], plan, { polygons }).meshes;
  const byScope = new Map(geometry.map(mesh => [scopeKey(mesh.scope.surveyId, mesh.scope.bssid.trim().toLowerCase(), mesh.scope.band, mesh.scope.frequency_mhz, mesh.polygonId ?? null), mesh]));
  const fields = [...groups].map(([key, group]) => {
    const nodes = [...group.samples.values()].map(p => ({ x: p.x, y: p.y, value: median(p.values) }));
    return { ...group, nodes, predict: fitRegularizedRssi(nodes, plan.width, smoothing), radius: radii.get(group.zone)!, mesh: byScope.get(key) };
  });
  return {
    model: null,
    sample(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return empty();
      let best: HybridSample = empty();
      for (const field of fields) {
        if (!inside(field.zone, x, y)) continue;
        let distance = Infinity;
        for (const node of field.nodes) distance = Math.min(distance, Math.hypot(node.x - x, node.y - y));
        if (distance > field.radius) continue;
        const value = field.predict(x, y);
        if (value === null || best.status !== 'NO_DATA' && value <= best.rssi) continue;
        const triangle = field.mesh ? sampleTriangleMesh(field.mesh, x, y) : null;
        const supported = triangle?.status === 'INTERPOLATED' && triangle.supported;
        best = { status: supported ? 'INTERPOLATED' : 'EXTRAPOLATED', rssi: value,
          confidence: Math.exp(-distance / Math.max(field.radius, 1)), source: field.source };
      }
      return best;
    },
  };
}
