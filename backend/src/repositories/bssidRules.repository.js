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

export function listAllSeenBssids() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT o.bssid AS bssid,
              COALESCE((
                SELECT o2.ssid FROM observations o2
                WHERE LOWER(o2.bssid) = LOWER(o.bssid)
                  AND o2.ssid IS NOT NULL AND TRIM(o2.ssid) != ''
                ORDER BY o2.id DESC
                LIMIT 1
              ), '') AS ssid,
              br.id AS rule_id,
              br.name AS rule_name,
              br.blacklisted AS blacklisted_flag
       FROM observations o
       LEFT JOIN bssid_rules br ON LOWER(br.bssid) = LOWER(o.bssid)
       ORDER BY COALESCE(NULLIF(ssid, ''), o.bssid) COLLATE NOCASE, LOWER(o.bssid)`
    )
    .all();
  return rows.map((row) => ({
    bssid: String(row.bssid).toLowerCase(),
    ssid: row.ssid || '',
    rule_id: row.rule_id || null,
    name: row.rule_name || '',
    blacklisted: !!row.blacklisted_flag,
  }));
}
