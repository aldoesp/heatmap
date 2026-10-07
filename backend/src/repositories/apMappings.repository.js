import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

export function listMappingsByPlan(plan_id) {
  return getDb()
    .prepare('SELECT * FROM ap_mappings WHERE plan_id = ? ORDER BY name ASC')
    .all(plan_id);
}

export function insertMapping({ plan_id, name, bssid }) {
  const id = randomUUID();
  getDb()
    .prepare('INSERT INTO ap_mappings (id, plan_id, name, bssid) VALUES (?, ?, ?, ?)')
    .run(id, plan_id, name, bssid.toLowerCase());
  return getDb().prepare('SELECT * FROM ap_mappings WHERE id = ?').get(id);
}

export function deleteMapping(id) {
  return getDb().prepare('DELETE FROM ap_mappings WHERE id = ?').run(id).changes > 0;
}
