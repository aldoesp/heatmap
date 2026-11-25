import type { HeatmapRow } from '../types/api.js';
import { buildZoneMask, pointInPolygonPx, type ZoneMask } from './polygon.js';
import { buildRssiMeshes, type RssiPolygonConstraint } from './heatmapRssi.js';
import { sampleTriangleMesh, type InterpolationMesh, type PlanReference } from './triangulation.js';
import type { HybridField, HybridSample } from './rssiHybridField.js';

export type RssiCalculation = 'hybrid' | 'regularized';
type Node = { x: number; y: number; value: number };
type Zone = { id: string | null; mask: ZoneMask | null; nodes: Map<string, Node> };
const empty = (): HybridSample => ({ status: 'NO_DATA', rssi: null });
// r² log(r) = ½ r² log(r²): avoid a square root for every node/pixel.
const kernelSquared = (r2: number) => r2 > 0 ? .5 * r2 * Math.log(r2) : 0;
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

export interface RegularizedRssiModel {
  predict(x: number, y: number): number | null;
  scale: number;
  x: readonly number[];
  y: readonly number[];
  lo: number;
  hi: number;
  coefficients: readonly number[] | null;
}

/** Thin-plate spline with affine tail, same normalization as the comparison. */
export function fitRegularizedRssiModel(nodes: readonly Node[], scale: number, smoothing = 1): RegularizedRssiModel {
  if (!nodes.length || !(scale > 0) || !Number.isFinite(smoothing) || smoothing < 0) {
    return { predict: () => null, scale, x: [], y: [], lo: 0, hi: 0, coefficients: null };
  }
  const n = nodes.length;
  const x = nodes.map(p => p.x / scale), y = nodes.map(p => p.y / scale);
  const lo = Math.min(...nodes.map(p => p.value)), hi = Math.max(...nodes.map(p => p.value));
  let coefficients: number[] | null = null;
  if (n >= 3) {
    const matrix = Array.from({ length: n + 3 }, () => Array<number>(n + 3).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dx = x[i] - x[j], dy = y[i] - y[j];
        matrix[i][j] = kernelSquared(dx * dx + dy * dy) + (i === j ? smoothing : 0);
      }
      matrix[i][n] = matrix[n][i] = 1;
      matrix[i][n + 1] = matrix[n + 1][i] = x[i];
      matrix[i][n + 2] = matrix[n + 2][i] = y[i];
    }
    coefficients = solve(matrix, [...nodes.map(p => p.value), 0, 0, 0]);
  }
  const predict = (px: number, py: number): number | null => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    let value: number;
    if (coefficients) {
      const nx = px / scale, ny = py / scale;
      value = coefficients[n] + coefficients[n + 1] * nx + coefficients[n + 2] * ny;
      for (let i = 0; i < n; i++) {
        const dx = nx - x[i], dy = ny - y[i];
        value += coefficients[i] * kernelSquared(dx * dx + dy * dy);
      }
    } else {
      // Sparse/collinear data: local IDW, still bounded by the field's radius.
      const nearest: { value: number; distanceSquared: number }[] = [];
      for (const p of nodes) {
        const dx = px - p.x, dy = py - p.y, distanceSquared = dx * dx + dy * dy;
        let index = 0;
        while (index < nearest.length && nearest[index].distanceSquared <= distanceSquared) index++;
        if (index < 4) {
          nearest.splice(index, 0, { value: p.value, distanceSquared });
          if (nearest.length > 4) nearest.pop();
        }
      }
      if (nearest[0].distanceSquared < 1e-12) return nearest[0].value;
      let sum = 0, weights = 0;
      for (const point of nearest) { const w = 1 / Math.max(point.distanceSquared, 1e-12); sum += point.value * w; weights += w; }
      value = sum / weights;
    }
    return Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : null;
  };
  return { predict, scale, x, y, lo, hi, coefficients };
}

/** Thin-plate spline with affine tail, same normalization as the comparison. */
export function fitRegularizedRssi(nodes: readonly Node[], scale: number, smoothing = 1): (x: number, y: number) => number | null {
  return fitRegularizedRssiModel(nodes, scale, smoothing).predict;
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
    const distances = points.map((p, i) => {
      let nearestSquared = Infinity;
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const dx = p.x - points[j].x, dy = p.y - points[j].y;
        nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
      }
      return Math.sqrt(nearestSquared);
    });
    radii.set(zone, points.length > 1 ? quantile(distances, .9) : Math.max(1, Math.min(plan.width, plan.height) * .02));
  }
  const geometry = meshes ?? buildRssiMeshes([...rows], plan, { polygons }).meshes;
  const byScope = new Map(geometry.map(mesh => [scopeKey(mesh.scope.surveyId, mesh.scope.bssid.trim().toLowerCase(), mesh.scope.band, mesh.scope.frequency_mhz, mesh.polygonId ?? null), mesh]));
  const fields = [...groups].map(([key, group]) => {
    const nodes = [...group.samples.values()].map(p => ({ x: p.x, y: p.y, value: median(p.values) }));
    return {
      ...group,
      nodes,
      model: fitRegularizedRssiModel(nodes, plan.width, smoothing),
      radius: radii.get(group.zone)!,
      mesh: byScope.get(key),
      zoneIndex: zones.indexOf(group.zone),
      nodeGroupIndex: -1,
      predictionSlot: -1,
    };
  });
  interface NodeGroup {
    /** Coordonnées plan en pixels, pour la distance au plus proche nœud. */
    px: Float64Array;
    py: Float64Array;
    /** Coordonnées normalisées par `scale`, pour le noyau TPS. */
    x: Float64Array;
    y: Float64Array;
    scale: number;
    fields: number[];
    predictionBase: number;
    coefficients: Float64Array;
    affine: Float64Array;
    maxHi: number;
  }
  const nodeGroupsByKey = new Map<string, NodeGroup>();
  fields.forEach((field, fieldIndex) => {
    const { coefficients, x, y, scale } = field.model;
    if (!coefficients) return;
    const key = `${scale}|${field.nodes.map(({ x, y }) => `${x},${y}`).join('|')}`;
    let group = nodeGroupsByKey.get(key);
    if (!group) {
      group = {
        px: new Float64Array(field.nodes.map((node) => node.x)),
        py: new Float64Array(field.nodes.map((node) => node.y)),
        x: new Float64Array(x),
        y: new Float64Array(y),
        scale,
        fields: [],
        predictionBase: 0,
        coefficients: new Float64Array(0),
        affine: new Float64Array(0),
        maxHi: -Infinity,
      };
      nodeGroupsByKey.set(key, group);
    }
    group.fields.push(fieldIndex);
  });
  const nodeGroups = [...nodeGroupsByKey.values()];
  let predictionCount = 0;
  nodeGroups.forEach((group, groupIndex) => {
    const memberCount = group.fields.length;
    const nodeCount = group.x.length;
    group.predictionBase = predictionCount;
    group.coefficients = new Float64Array(nodeCount * memberCount);
    group.affine = new Float64Array(memberCount * 3);
    group.fields.forEach((fieldIndex, memberIndex) => {
      const field = fields[fieldIndex];
      const coefficients = field.model.coefficients!;
      const n = coefficients.length - 3;
      group.affine[memberIndex * 3] = coefficients[n];
      group.affine[memberIndex * 3 + 1] = coefficients[n + 1];
      group.affine[memberIndex * 3 + 2] = coefficients[n + 2];
      for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
        group.coefficients[nodeIndex * memberCount + memberIndex] = coefficients[nodeIndex];
      }
      field.nodeGroupIndex = groupIndex;
      field.predictionSlot = group.predictionBase + memberIndex;
      group.maxHi = Math.max(group.maxHi, field.model.hi);
    });
    predictionCount += memberCount;
  });
  const zoneStates = new Int8Array(zones.length);
  const groupDistances = new Float64Array(nodeGroups.length);
  const groupStates = new Uint8Array(nodeGroups.length);
  const predictions = new Float64Array(predictionCount);
  return {
    model: null,
    sample(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return empty();
      groupStates.fill(0);
      for (let zoneIndex = 0; zoneIndex < zones.length; zoneIndex += 1) {
        zoneStates[zoneIndex] = inside(zones[zoneIndex], x, y) ? 1 : 0;
      }
      let bestField: (typeof fields)[number] | null = null;
      let bestRssi = -Infinity;
      let bestDistanceSquared = 0;
      let bestSupported = false;
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        const field = fields[fieldIndex];
        if (!zoneStates[field.zoneIndex]) continue;
        let distanceSquared: number;
        let value: number | null;
        if (field.nodeGroupIndex >= 0) {
          const groupIndex = field.nodeGroupIndex;
          const group = nodeGroups[groupIndex];
          if (bestField !== null && group.maxHi <= bestRssi) continue;
          if (groupStates[groupIndex] === 0) {
            let nearestSquared = Infinity;
            const px = group.px, py = group.py;
            for (let nodeIndex = 0; nodeIndex < px.length; nodeIndex += 1) {
              const dx = px[nodeIndex] - x, dy = py[nodeIndex] - y;
              const candidate = dx * dx + dy * dy;
              if (candidate < nearestSquared) nearestSquared = candidate;
            }
            groupDistances[groupIndex] = nearestSquared;
            groupStates[groupIndex] = 1;
          }
          distanceSquared = groupDistances[groupIndex];
          if (distanceSquared > field.radius * field.radius) continue;
          if (groupStates[groupIndex] === 1) {
            const nx = x / group.scale, ny = y / group.scale;
            const base = group.predictionBase;
            const memberCount = group.fields.length;
            const affine = group.affine;
            for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
              const offset = memberIndex * 3;
              predictions[base + memberIndex] = affine[offset] + affine[offset + 1] * nx + affine[offset + 2] * ny;
            }
            const coefficients = group.coefficients;
            const gx = group.x, gy = group.y;
            for (let nodeIndex = 0; nodeIndex < gx.length; nodeIndex += 1) {
              const dx = nx - gx[nodeIndex], dy = ny - gy[nodeIndex];
              const kernel = kernelSquared(dx * dx + dy * dy);
              const coefficientBase = nodeIndex * memberCount;
              for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
                predictions[base + memberIndex] += coefficients[coefficientBase + memberIndex] * kernel;
              }
            }
            groupStates[groupIndex] = 2;
          }
          if (bestField !== null && field.model.hi <= bestRssi) continue;
          const raw = predictions[field.predictionSlot];
          if (!Number.isFinite(raw)) continue;
          value = Math.max(field.model.lo, Math.min(field.model.hi, raw));
        } else {
          distanceSquared = Infinity;
          for (const node of field.nodes) {
            const dx = node.x - x, dy = node.y - y;
            const candidate = dx * dx + dy * dy;
            if (candidate < distanceSquared) distanceSquared = candidate;
          }
          if (distanceSquared > field.radius * field.radius) continue;
          if (bestField !== null && field.model.hi <= bestRssi) continue;
          value = field.model.predict(x, y);
        }
        if (value === null || bestField !== null && value <= bestRssi) continue;
        const triangle = field.mesh ? sampleTriangleMesh(field.mesh, x, y) : null;
        bestField = field;
        bestRssi = value;
        bestDistanceSquared = distanceSquared;
        bestSupported = triangle?.status === 'INTERPOLATED' && triangle.supported;
      }
      if (bestField === null) return empty();
      return {
        status: bestSupported ? 'INTERPOLATED' : 'EXTRAPOLATED',
        rssi: bestRssi,
        confidence: Math.exp(-Math.sqrt(bestDistanceSquared) / Math.max(bestField.radius, 1)),
        source: bestField.source,
      };
    },
  };
}

