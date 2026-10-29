import { getDb } from '../database/db.js';

function toApPosition(row) {
  if (!row) return null;
  return {
    plan_id: row.plan_id,
    bssid: row.bssid,
    x: row.x,
    y: row.y,
    updated_at: row.updated_at,
  };
}

export function listApPositionsByPlan(plan_id) {
  return getDb()
    .prepare('SELECT * FROM ap_positions WHERE plan_id = ? ORDER BY bssid ASC')
    .all(plan_id)
    .map(toApPosition);
}

export function upsertApPosition({ plan_id, bssid, x, y }) {
  getDb()
    .prepare(
      `INSERT INTO ap_positions (plan_id, bssid, x, y, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(plan_id, bssid) DO UPDATE SET x=excluded.x, y=excluded.y, updated_at=datetime('now')`
    )
    .run(plan_id, bssid, x, y);
  const row = getDb()
    .prepare('SELECT * FROM ap_positions WHERE plan_id = ? AND bssid = ?')
    .get(plan_id, bssid);
  return toApPosition(row);
}

export function deleteApPosition(plan_id, bssid) {
  return getDb().prepare('DELETE FROM ap_positions WHERE plan_id = ? AND bssid = ?').run(plan_id, bssid).changes > 0;
}
