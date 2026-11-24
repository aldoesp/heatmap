import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';
import { readCached } from '../cache/readCache.js';

const namedRulesStatements = new WeakMap();

function namedRulesStatement(db) {
  let statement = namedRulesStatements.get(db);
  if (!statement) {
    statement = db.prepare("SELECT bssid, name FROM bssid_rules WHERE name != ''");
    namedRulesStatements.set(db, statement);
  }
  return statement;
}

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
  if (rows.length === 0) return rows;
  const names = new Map();
  for (const rule of namedRulesStatement(getDb()).all()) {
    names.set(rule.bssid.toLowerCase(), rule.name);
  }
  return rows.map((row) => {
    const key = String(row.bssid).toLowerCase();
    return {
      ...row,
      bssid_name: names.get(key) ?? row.bssid,
    };
  });
}

export function listAllSeenBssids() {
  const db = getDb();
  return readCached(db, () => ['bssid', 'seen', 'all'], () => loadAllSeenBssids(db));
}

function loadAllSeenBssids(db) {
  const rows = db
    .prepare(
      `WITH latest_ssid AS (
         SELECT MIN(o.bssid) AS bssid_key, MAX(o.id) AS observation_id
         FROM observations o
         WHERE o.ssid IS NOT NULL AND TRIM(o.ssid) != ''
         GROUP BY o.bssid COLLATE NOCASE
       ),
       seen AS (
         SELECT DISTINCT o.bssid AS bssid
         FROM observations o
       )
       SELECT seen.bssid AS bssid,
              COALESCE(o2.ssid, '') AS ssid,
              br.id AS rule_id,
              br.name AS rule_name,
              br.blacklisted AS blacklisted_flag
       FROM seen
       LEFT JOIN latest_ssid ls ON ls.bssid_key = seen.bssid COLLATE NOCASE
       LEFT JOIN observations o2 ON o2.id = ls.observation_id
       LEFT JOIN bssid_rules br ON br.bssid = seen.bssid COLLATE NOCASE
       ORDER BY COALESCE(NULLIF(o2.ssid, ''), seen.bssid) COLLATE NOCASE,
                seen.bssid COLLATE NOCASE`
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
