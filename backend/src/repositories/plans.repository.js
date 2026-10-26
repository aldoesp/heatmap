import { getDb } from '../database/db.js';

export function insertPlan(row) {
  const db = getDb();
  db.prepare(
    `INSERT INTO plans (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes)
     VALUES (@id, @name, @file_name, @stored_file, @image_url, @mime, @width, @height, @size_bytes)`
  ).run(row);
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
  const r = db
    .prepare(`UPDATE plans SET name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, id);
  return r.changes > 0 ? findPlanById(id) : null;
}

export function deletePlan(id) {
  return getDb().prepare('DELETE FROM plans WHERE id = ?').run(id).changes > 0;
}
