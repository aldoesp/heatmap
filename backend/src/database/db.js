import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
