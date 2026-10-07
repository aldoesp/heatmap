import { getDb } from '../database/db.js';

export const SETTING_KEYS = ['iperf_server', 'iperf_duration_s', 'scan_mode'];

export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? '';
}

export function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = Object.fromEntries(SETTING_KEYS.map((k) => [k, '']));
  for (const r of rows) {
    if (SETTING_KEYS.includes(r.key)) out[r.key] = r.value;
  }
  return out;
}

export function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value);
  return { key, value };
}
