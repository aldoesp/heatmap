import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

export function insertScanPoint({ plan_id, x, y }) {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO scan_points (id, plan_id, x, y) VALUES (?, ?, ?, ?)`)
    .run(id, plan_id, x, y);
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

export function deleteScanPoint(id) {
  return getDb().prepare('DELETE FROM scan_points WHERE id = ?').run(id).changes > 0;
}
