import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

export function insertScanPoint({ plan_id, survey_id = null, x, y }) {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO scan_points (id, plan_id, survey_id, x, y) VALUES (?, ?, ?, ?, ?)`)
    .run(id, plan_id, survey_id, x, y);
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
  return getDb().prepare('DELETE FROM scan_points WHERE id = ?').run(id).changes > 0;
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
  const r = getDb()
    .prepare(`UPDATE scan_points SET ${fields.join(', ')} WHERE id = ?`)
    .run(...params);
  return r.changes > 0 ? findScanPointById(id) : null;
}
