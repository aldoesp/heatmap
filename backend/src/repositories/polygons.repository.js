import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

/**
 * Zones de délimitation : les sommets sont stockés en JSON dans le repère
 * normalisé du projet (x, y ∈ [0,1], y = 0 en bas), comme les points de scan.
 */
function toPolygon(row) {
  if (!row) return null;
  let vertices = [];
  try {
    const parsed = JSON.parse(row.vertices);
    if (Array.isArray(parsed)) vertices = parsed;
  } catch {
    /* JSON corrompu : renvoyé vide, la validation applicative protège l'écriture */
  }
  return {
    id: row.id,
    plan_id: row.plan_id,
    vertices,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function insertPolygon({ plan_id, vertices }) {
  const id = randomUUID();
  getDb()
    .prepare('INSERT INTO polygons (id, plan_id, vertices) VALUES (?, ?, ?)')
    .run(id, plan_id, JSON.stringify(vertices));
  return findPolygonById(id);
}

export function findPolygonById(id) {
  const row = getDb().prepare('SELECT * FROM polygons WHERE id = ?').get(id);
  return toPolygon(row);
}

export function listPolygonsByPlan(plan_id) {
  return getDb()
    .prepare(
      'SELECT * FROM polygons WHERE plan_id = ? ORDER BY created_at ASC, id ASC'
    )
    .all(plan_id)
    .map(toPolygon);
}

export function updatePolygon(id, vertices) {
  const result = getDb()
    .prepare(
      `UPDATE polygons SET vertices = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(JSON.stringify(vertices), id);
  return result.changes > 0 ? findPolygonById(id) : null;
}

export function deletePolygon(id) {
  return getDb().prepare('DELETE FROM polygons WHERE id = ?').run(id).changes > 0;
}
