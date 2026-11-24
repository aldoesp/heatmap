import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';
import { runDataWrite } from '../cache/dataRevision.js';
import { invalidateObservationData, listAffectedPointScopes, resolveInvalidationScope } from '../cache/invalidation.js';

const SURVEY_SELECT = `
  SELECT s.*, p.name AS plan_name, p.image_url, p.width AS plan_width,
         p.height AS plan_height
  FROM surveys s
  JOIN plans p ON p.id = s.plan_id`;

export function insertSurvey({ plan_id, name }) {
  const id = randomUUID();
  runDataWrite(getDb(), 'INSERT INTO surveys (id, plan_id, name) VALUES (?, ?, ?)', id, plan_id, name);
  return findSurveyById(id);
}

export function listSurveysByPlan(plan_id) {
  return getDb()
    .prepare(`${SURVEY_SELECT} WHERE s.plan_id = ? ORDER BY s.created_at DESC`)
    .all(plan_id);
}

export function findSurveyById(id) {
  return getDb().prepare(`${SURVEY_SELECT} WHERE s.id = ?`).get(id) ?? null;
}

export function renameSurvey(id, name) {
  const result = runDataWrite(getDb(), `UPDATE surveys SET name = ?, updated_at = datetime('now') WHERE id = ?`, name, id);
  return result.changes ? findSurveyById(id) : null;
}

export function deleteSurvey(id) {
  const db = getDb();
  const scopes = resolveInvalidationScope(() => [
    db.prepare('SELECT plan_id, id AS survey_id FROM surveys WHERE id = ?').get(id),
    ...listAffectedPointScopes(db, 'sp.survey_id = ?', id),
  ]);
  const deleted = runDataWrite(db, 'DELETE FROM surveys WHERE id = ?', id).changes > 0;
  if (deleted) invalidateObservationData(scopes);
  return deleted;
}
