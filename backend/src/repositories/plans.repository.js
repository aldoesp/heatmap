import { getDb } from '../database/db.js';
import { runDataWrite } from '../cache/dataRevision.js';
import { invalidateObservationData, listAffectedPointScopes, resolveInvalidationScope } from '../cache/invalidation.js';

export function insertPlan(row) {
  const db = getDb();
  runDataWrite(db,
    `INSERT INTO plans (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes)
     VALUES (@id, @name, @file_name, @stored_file, @image_url, @mime, @width, @height, @size_bytes)`,
    row
  );
  return findPlanById(row.id);
}

export function findPlanById(id) {
  return getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id) ?? null;
}

export function listPlans() {
  return getDb()
    .prepare('SELECT * FROM plans ORDER BY created_at DESC')
    .all();
}

export function renamePlan(id, name) {
  const db = getDb();
  const r = runDataWrite(db, `UPDATE plans SET name = ?, updated_at = datetime('now') WHERE id = ?`, name, id);
  return r.changes > 0 ? findPlanById(id) : null;
}

export function deletePlan(id) {
  const db = getDb();
  const scopes = resolveInvalidationScope(() => [
    { plan_id: id },
    ...db.prepare('SELECT plan_id, id AS survey_id FROM surveys WHERE plan_id = ?').all(id),
    ...listAffectedPointScopes(
      db, 'sp.plan_id = ? OR sp.survey_id IN (SELECT id FROM surveys WHERE plan_id = ?) OR s.plan_id = ?',
      id, id, id,
    ),
  ]);
  const deleted = runDataWrite(db, 'DELETE FROM plans WHERE id = ?', id).changes > 0;
  if (deleted) invalidateObservationData(scopes);
  return deleted;
}
