import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

const SURVEY_SELECT = `
  SELECT s.*, p.name AS plan_name, p.image_url, p.width AS plan_width,
         p.height AS plan_height
  FROM surveys s
  JOIN plans p ON p.id = s.plan_id`;

export function insertSurvey({ plan_id, name }) {
  const id = randomUUID();
  getDb()
    .prepare('INSERT INTO surveys (id, plan_id, name) VALUES (?, ?, ?)')
    .run(id, plan_id, name);
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
  const result = getDb()
    .prepare(`UPDATE surveys SET name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, id);
  return result.changes ? findSurveyById(id) : null;
}

export function deleteSurvey(id) {
  return getDb().prepare('DELETE FROM surveys WHERE id = ?').run(id).changes > 0;
}
