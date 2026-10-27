import { getDb } from '../database/db.js';

const TABLES = [
  'plans',
  'surveys',
  'access_points',
  'scan_points',
  'ap_mappings',
  'bssid_rules',
  'speed_tests',
  'settings',
  'scans',
  'observations',
  'ping_stats',
  'simulation_scenarios',
];

export function exportAll(_req, res) {
  const db = getDb();
  const data = {};
  for (const table of TABLES) {
    data[table] = db.prepare(`SELECT * FROM ${table}`).all();
  }
  res.json({ exported_at: new Date().toISOString(), data });
}
