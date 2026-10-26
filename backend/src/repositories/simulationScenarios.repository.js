import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

/**
 * Scénarios de simulation : une copie indépendante d'un AP réel.
 * Les positions (x,y normalisées, y=0 en bas) sont stockées en colonnes et
 * les configurations radio (`radio` = paramètres courants, `initial_radio` =
 * paramètres d'origine) en JSON. `initial_*` n'est jamais modifié par un
 * PATCH : c'est l'état restauré par POST /:id/reset.
 */

const SCENARIO_COLUMNS = `
  id, plan_id, source_access_point_id, name,
  initial_x, initial_y, initial_radio,
  current_x, current_y, radio,
  created_at, updated_at`;

function toScenario(row) {
  if (!row) return null;
  let radio = {};
  let initialRadio = {};
  try {
    radio = JSON.parse(row.radio);
  } catch {
    /* JSON corrompu : renvoyé tel quel, la validation applicative protège l'insertion */
  }
  try {
    initialRadio = JSON.parse(row.initial_radio);
  } catch {
    /* idem */
  }
  return {
    id: row.id,
    plan_id: row.plan_id,
    source_access_point_id: row.source_access_point_id,
    name: row.name,
    initial: { x: row.initial_x, y: row.initial_y },
    current: { x: row.current_x, y: row.current_y },
    initialRadio,
    radio,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function insertScenario({
  plan_id,
  source_access_point_id = null,
  name,
  initial_x,
  initial_y,
  initial_radio,
  current_x = initial_x,
  current_y = initial_y,
  radio = initial_radio,
}) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO simulation_scenarios
        (id, plan_id, source_access_point_id, name,
         initial_x, initial_y, initial_radio, current_x, current_y, radio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      plan_id,
      source_access_point_id,
      name,
      initial_x,
      initial_y,
      JSON.stringify(initial_radio),
      current_x,
      current_y,
      JSON.stringify(radio)
    );
  return findScenarioById(id);
}

export function listScenariosByPlan(plan_id) {
  return getDb()
    .prepare(
      `SELECT ${SCENARIO_COLUMNS} FROM simulation_scenarios
       WHERE plan_id = ? ORDER BY created_at ASC`
    )
    .all(plan_id)
    .map(toScenario);
}

export function findScenarioById(id) {
  const row = getDb()
    .prepare(`SELECT ${SCENARIO_COLUMNS} FROM simulation_scenarios WHERE id = ?`)
    .get(id);
  return toScenario(row);
}

/** PATCH : uniquement la position courante, la radio courante et le nom. */
export function updateScenario(id, { name, current_x, current_y, radio }) {
  const fields = [];
  const params = [];
  if (name !== undefined) {
    fields.push('name = ?');
    params.push(name);
  }
  if (current_x !== undefined) {
    fields.push('current_x = ?');
    params.push(current_x);
  }
  if (current_y !== undefined) {
    fields.push('current_y = ?');
    params.push(current_y);
  }
  if (radio !== undefined) {
    fields.push('radio = ?');
    params.push(JSON.stringify(radio));
  }
  if (fields.length === 0) return findScenarioById(id);
  fields.push(`updated_at = datetime('now')`);
  params.push(id);
  getDb()
    .prepare(
      `UPDATE simulation_scenarios SET ${fields.join(', ')} WHERE id = ?`
    )
    .run(...params);
  return findScenarioById(id);
}

/** Réinitialisation : la copie revient à sa configuration initiale. */
export function resetScenario(id) {
  getDb()
    .prepare(
      `UPDATE simulation_scenarios
       SET current_x = initial_x, current_y = initial_y,
           radio = initial_radio, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(id);
  return findScenarioById(id);
}

export function deleteScenario(id) {
  return getDb()
    .prepare('DELETE FROM simulation_scenarios WHERE id = ?')
    .run(id).changes > 0;
}
