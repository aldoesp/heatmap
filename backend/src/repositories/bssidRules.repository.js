import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

export function listBssidRules() {
  return getDb()
    .prepare(
      `SELECT id, bssid, name, blacklisted, created_at
       FROM bssid_rules
       ORDER BY name COLLATE NOCASE, bssid`
    )
    .all()
    .map((rule) => ({ ...rule, blacklisted: !!rule.blacklisted }));
}

export function findBssidRuleById(id) {
  const rule = getDb()
    .prepare('SELECT id, bssid, name, blacklisted, created_at FROM bssid_rules WHERE id = ?')
    .get(id);
  return rule ? { ...rule, blacklisted: !!rule.blacklisted } : null;
}

export function insertBssidRule({ bssid, name, blacklisted }) {
  const id = randomUUID();
  getDb()
    .prepare(
      'INSERT INTO bssid_rules (id, bssid, name, blacklisted) VALUES (?, ?, ?, ?)'
    )
    .run(id, bssid.toLowerCase(), name, blacklisted ? 1 : 0);
  return findBssidRuleById(id);
}

export function updateBssidRule(id, { name, blacklisted }) {
  getDb()
    .prepare('UPDATE bssid_rules SET name = ?, blacklisted = ? WHERE id = ?')
    .run(name, blacklisted ? 1 : 0, id);
  return findBssidRuleById(id);
}

export function deleteBssidRule(id) {
  return getDb().prepare('DELETE FROM bssid_rules WHERE id = ?').run(id).changes > 0;
}

export function listBlacklistedBssids() {
  return getDb()
    .prepare('SELECT bssid FROM bssid_rules WHERE blacklisted = 1')
    .all()
    .map(({ bssid }) => bssid.toLowerCase());
}

export function withBssidNames(rows) {
  const names = new Map(
    getDb()
      .prepare("SELECT bssid, name FROM bssid_rules WHERE name != ''")
      .all()
      .map(({ bssid, name }) => [bssid.toLowerCase(), name])
  );
  return rows.map((row) => ({
    ...row,
    bssid_name: names.get(String(row.bssid).toLowerCase()) ?? row.bssid,
  }));
}
