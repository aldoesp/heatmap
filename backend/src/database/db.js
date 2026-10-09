import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/data/heatmap.db par défaut, surchargeable via DB_PATH
const DB_PATH =
  process.env.DB_PATH ||
  path.resolve(__dirname, '../../data/heatmap.db');

let db = null;

export function getDb() {
  if (db) return db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate(db);
  return db;
}

// Migrations des bases créées avant l'ajout d'une colonne (données conservées).
function migrate(db) {
  const columnsOf = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const scanPoints = columnsOf('scan_points');
  if (!scanPoints.includes('survey_id')) {
    db.exec('ALTER TABLE scan_points ADD COLUMN survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE');
  }
  if (!scanPoints.includes('note')) {
    db.exec('ALTER TABLE scan_points ADD COLUMN note TEXT DEFAULT NULL');
  }
  if (!scanPoints.includes('is_enabled')) {
    db.exec('ALTER TABLE scan_points ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1');
  }
  const scans = columnsOf('scans');
  if (!scans.includes('gateway_ip')) {
    db.exec('ALTER TABLE scans ADD COLUMN gateway_ip TEXT DEFAULT NULL');
  }
  if (!scans.includes('gateway_rtt_ms')) {
    db.exec('ALTER TABLE scans ADD COLUMN gateway_rtt_ms REAL DEFAULT NULL');
  }
  if (!scans.includes('gateway_loss_percent')) {
    db.exec('ALTER TABLE scans ADD COLUMN gateway_loss_percent REAL DEFAULT NULL');
  }
  const observations = columnsOf('observations');
  if (!observations.includes('unreliable_bssid')) {
    db.exec('ALTER TABLE observations ADD COLUMN unreliable_bssid INTEGER NOT NULL DEFAULT 0');
  }
  if (!observations.includes('current')) {
    db.exec('ALTER TABLE observations ADD COLUMN current INTEGER NOT NULL DEFAULT 0');
  }

  // Keep existing plan-level history together as an initial campaign per plan.
  const migrateLegacySurveys = db.transaction(() => {
    const plans = db
      .prepare(
        `SELECT p.id, p.name, p.created_at
         FROM plans p
         WHERE NOT EXISTS (SELECT 1 FROM surveys s WHERE s.plan_id = p.id)`
      )
      .all();
    const insertSurvey = db.prepare(
      `INSERT INTO surveys (id, plan_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const assignPoints = db.prepare(
      `UPDATE scan_points SET survey_id = ?
       WHERE plan_id = ? AND survey_id IS NULL`
    );
    for (const plan of plans) {
      const surveyId = randomUUID();
      insertSurvey.run(surveyId, plan.id, plan.name, plan.created_at, plan.created_at);
      assignPoints.run(surveyId, plan.id);
    }
  });
  migrateLegacySurveys();

  const rulesMigrated = db
    .prepare("SELECT 1 FROM settings WHERE key = 'bssid_rules_migrated'")
    .get();
  if (!rulesMigrated) {
    const migrateLegacyMappings = db.transaction(() => {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO bssid_rules (id, bssid, name)
         VALUES (?, ?, ?)`
      );
      const mappings = db
        .prepare('SELECT bssid, name FROM ap_mappings ORDER BY created_at DESC')
        .all();
      for (const mapping of mappings) {
        insert.run(randomUUID(), String(mapping.bssid).toLowerCase(), mapping.name);
      }
      db.prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('bssid_rules_migrated', '1', datetime('now'))`
      ).run();
    });
    migrateLegacyMappings();
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
