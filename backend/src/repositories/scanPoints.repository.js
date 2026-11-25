import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';
import { runDataWrite } from '../cache/dataRevision.js';
import { invalidateObservationData, invalidateScopes, listAffectedPointScopes, resolveInvalidationScope } from '../cache/invalidation.js';

export function insertScanPoint({ plan_id, survey_id = null, x, y }) {
  const id = randomUUID();
  runDataWrite(getDb(),
    'INSERT INTO scan_points (id, plan_id, survey_id, x, y) VALUES (?, ?, ?, ?, ?)',
    id, plan_id, survey_id, x, y,
  );
  invalidateScopes([{ plan_id, survey_id }], ['history']);
  return findScanPointById(id);
}

export function findScanPointById(id) {
  return getDb().prepare('SELECT * FROM scan_points WHERE id = ?').get(id) ?? null;
}

export function listScanPointsByPlan(plan_id) {
  return getDb()
    .prepare('SELECT * FROM scan_points WHERE plan_id = ? ORDER BY created_at ASC')
    .all(plan_id);
}

export function listScanPointsBySurvey(survey_id) {
  return getDb()
    .prepare('SELECT * FROM scan_points WHERE survey_id = ? ORDER BY created_at ASC')
    .all(survey_id);
}

export function deleteScanPoint(id) {
  const db = getDb();
  const scopes = resolveInvalidationScope(() => listAffectedPointScopes(db, 'sp.id = ?', id));
  const deleted = runDataWrite(db, 'DELETE FROM scan_points WHERE id = ?', id).changes > 0;
  if (deleted) {
    if (scopes?.length && scopes.every(scope => scope.scan_plan_id == null)) {
      invalidateScopes(scopes, ['history']);
    } else {
      invalidateObservationData(scopes?.length ? scopes : null);
    }
  }
  return deleted;
}

export function updateScanPoint(id, patch) {
  const fields = [];
  const params = [];
  if (patch.note !== undefined) {
    fields.push('note = ?');
    params.push(patch.note);
  }
  if (patch.is_enabled !== undefined) {
    fields.push('is_enabled = ?');
    params.push(patch.is_enabled ? 1 : 0);
  }
  if (fields.length === 0) return findScanPointById(id);
  params.push(id);
  const r = runDataWrite(getDb(), `UPDATE scan_points SET ${fields.join(', ')} WHERE id = ?`, ...params);
  if (!r.changes) return null;
  let point;
  try {
    point = findScanPointById(id);
    return point;
  } finally {
    const domains = patch.is_enabled === undefined
      ? ['history', 'analysis']
      : ['history', 'heatmap', 'speed', 'analysis'];
    invalidateScopes([point], domains);
  }
}
