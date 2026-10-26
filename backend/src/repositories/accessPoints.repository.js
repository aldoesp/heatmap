import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

export function insertAccessPoint({ plan_id, name, x, y }) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO access_points (id, plan_id, name, x, y) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, plan_id, name, x, y);
  return findAccessPointById(id);
}

export function findAccessPointById(id) {
  return getDb().prepare('SELECT * FROM access_points WHERE id = ?').get(id) ?? null;
}

export function listAccessPointsByPlan(plan_id) {
  return getDb()
    .prepare('SELECT * FROM access_points WHERE plan_id = ? ORDER BY created_at ASC')
    .all(plan_id);
}

export function deleteAccessPoint(id) {
  return getDb().prepare('DELETE FROM access_points WHERE id = ?').run(id).changes > 0;
}

export function updateAccessPoint(id, patch) {
  const fields = [];
  const params = [];
  if (patch.name !== undefined) {
    fields.push('name = ?');
    params.push(patch.name);
  }
  if (patch.x !== undefined) {
    fields.push('x = ?');
    params.push(patch.x);
  }
  if (patch.y !== undefined) {
    fields.push('y = ?');
    params.push(patch.y);
  }
  if (fields.length === 0) return findAccessPointById(id);
  params.push(id);
  const r = getDb()
    .prepare(`UPDATE access_points SET ${fields.join(', ')} WHERE id = ?`)
    .run(...params);
  return r.changes > 0 ? findAccessPointById(id) : null;
}
