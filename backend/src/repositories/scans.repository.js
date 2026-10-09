import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';
import { rssiToQuality } from '../utils/wifi.utils.js';
import { withBssidNames } from './bssidRules.repository.js';

// Sauve un scan complet (déjà normalisé) + ses observations en transaction.
export function insertScanWithObservations({ scan_point_id, plan_id, mode, scanned_at, rejected_count, gateway, entries }) {
  const db = getDb();
  const scan_id = randomUUID();
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO scans (id, scan_point_id, plan_id, mode, scanned_at, rejected_count,
                          gateway_ip, gateway_rtt_ms, gateway_loss_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      scan_id, scan_point_id, plan_id, mode, scanned_at, rejected_count,
      gateway?.gatewayIp ?? null,
      gateway?.medianRttMs ?? null,
      gateway?.packetLossPercent ?? null
    );

    const stmt = db.prepare(
      `INSERT INTO observations
        (scan_id, bssid, ssid, hidden, band, frequency_mhz, channel, bandwidth_mhz,
         center_frequency_mhz, center_channel, rssi, quality, level, security,
         standard, virtual_bssid, unreliable_bssid, current, capabilities, timestamp_us)
       VALUES (@scan_id, @bssid, @ssid, @hidden, @band, @frequency_mhz, @channel,
         @bandwidth_mhz, @center_frequency_mhz, @center_channel, @rssi, @quality,
         @level, @security, @standard, @virtual_bssid, @unreliable_bssid, @current,
         @capabilities, @timestamp_us)`
    );
    for (const e of entries) {
      stmt.run({
        scan_id,
        bssid: e.bssid,
        ssid: e.ssid,
        hidden: e.hidden ? 1 : 0,
        band: e.band,
        frequency_mhz: e.frequency_mhz,
        channel: e.channel,
        bandwidth_mhz: e.bandwidth_mhz,
        center_frequency_mhz: e.center_frequency_mhz,
        center_channel: e.center_channel,
        rssi: e.rssi,
        quality: e.quality,
        level: e.level,
        security: e.security,
        standard: e.standard,
        virtual_bssid: e.virtual_bssid ? 1 : 0,
        unreliable_bssid: e.unreliable_bssid ? 1 : 0,
        current: e.current ? 1 : 0,
        capabilities: JSON.stringify(e.capabilities ?? []),
        timestamp_us: e.timestamp_us,
      });
    }
  });
  insert();
  return scan_id;
}

export function findScanById(id) {
  return getDb().prepare('SELECT * FROM scans WHERE id = ?').get(id) ?? null;
}

export function insertSpeedTest({ scan_id, tcp_down_bps, tcp_up_bps, duration_s, error }) {
  getDb()
    .prepare(
      `INSERT INTO speed_tests (scan_id, tcp_down_bps, tcp_up_bps, duration_s, error)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(scan_id, tcp_down_bps, tcp_up_bps, duration_s, error ?? null);
  return findSpeedByScan(scan_id);
}

export function findSpeedByScan(scan_id) {
  return getDb().prepare('SELECT * FROM speed_tests WHERE scan_id = ?').get(scan_id) ?? null;
}

// Débit descendant max par point (points activés, pour la heatmap).
export function speedByPlan(plan_id) {
  return getDb()
    .prepare(
      `SELECT sp.id AS scan_point_id, sp.x, sp.y, MAX(st.tcp_down_bps) AS speed_bps
       FROM scan_points sp
       JOIN scans s ON s.scan_point_id = sp.id
       JOIN speed_tests st ON st.scan_id = s.id
       WHERE sp.plan_id = ? AND sp.is_enabled = 1 AND st.tcp_down_bps IS NOT NULL
       GROUP BY sp.id
       ORDER BY sp.created_at ASC`
    )
    .all(plan_id);
}

export function speedBySurvey(survey_id) {
  return getDb()
    .prepare(
      `SELECT sp.id AS scan_point_id, sp.x, sp.y, MAX(st.tcp_down_bps) AS speed_bps
       FROM scan_points sp
       JOIN scans s ON s.scan_point_id = sp.id
       JOIN speed_tests st ON st.scan_id = s.id
       WHERE sp.survey_id = ? AND sp.is_enabled = 1 AND st.tcp_down_bps IS NOT NULL
       GROUP BY sp.id
       ORDER BY sp.created_at ASC`
    )
    .all(survey_id);
}

export function listScansByPoint(scan_point_id) {
  return getDb()
    .prepare('SELECT * FROM scans WHERE scan_point_id = ? ORDER BY created_at ASC')
    .all(scan_point_id);
}

export function listScansByPlan(plan_id) {
  return getDb()
    .prepare('SELECT * FROM scans WHERE plan_id = ? ORDER BY created_at ASC')
    .all(plan_id);
}

export function countObservationsByScan(scan_id) {
  return getDb().prepare(
      `SELECT COUNT(*) AS count FROM observations o
       WHERE o.scan_id = ? AND NOT EXISTS (
         SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
       )`
    )
    .get(scan_id).count;
}

// Historique d'un plan : points + leurs scans + nombre de réseaux par scan
export function getHistoryByPlan(plan_id) {
  const db = getDb();
  const points = db
    .prepare('SELECT * FROM scan_points WHERE plan_id = ? ORDER BY created_at ASC')
    .all(plan_id);
  return historyForPoints(points);
}

export function getHistoryBySurvey(survey_id) {
  const points = getDb()
    .prepare('SELECT * FROM scan_points WHERE survey_id = ? ORDER BY created_at ASC')
    .all(survey_id);
  return historyForPoints(points);
}

function historyForPoints(points) {
  const db = getDb();
  return points.map((p) => {
    const scans = db
      .prepare(
        `SELECT s.*, st.tcp_down_bps, st.tcp_up_bps
         FROM scans s LEFT JOIN speed_tests st ON st.scan_id = s.id
         WHERE s.scan_point_id = ? ORDER BY s.created_at ASC`
      )
      .all(p.id);
    return {
      ...p,
      scans: scans.map((s) => ({
        ...s,
        network_count: db
          .prepare(
            `SELECT COUNT(*) AS count FROM observations o
             WHERE o.scan_id = ? AND NOT EXISTS (
               SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
             )`
          )
          .get(s.id).count,
      })),
    };
  });
}

// Réseaux distincts vus sur un plan (pour les filtres SSID/BSSID)
export function listNetworksByPlan(plan_id) {
  return withBssidNames(getDb()
    .prepare(
      `SELECT o.ssid, o.bssid, COUNT(DISTINCT s.id) AS scan_count,
              MAX(o.rssi) AS best_rssi
       FROM observations o
       JOIN scans s ON s.id = o.scan_id
       WHERE s.plan_id = ? AND NOT EXISTS (
         SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
       )
       GROUP BY o.ssid, o.bssid
       ORDER BY best_rssi DESC`
    )
    .all(plan_id));
}

export function listNetworksBySurvey(survey_id) {
  return withBssidNames(getDb()
    .prepare(
      `SELECT o.ssid, o.bssid, COUNT(DISTINCT s.id) AS scan_count,
              MAX(o.rssi) AS best_rssi
       FROM observations o
       JOIN scans s ON s.id = o.scan_id
       JOIN scan_points sp ON sp.id = s.scan_point_id
       WHERE sp.survey_id = ? AND NOT EXISTS (
         SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
       )
       GROUP BY o.ssid, o.bssid
       ORDER BY best_rssi DESC`
    )
    .all(survey_id));
}

export function listObservationsByScan(scan_id, { ssid, band, minRssi } = {}) {
  let sql = `SELECT o.* FROM observations o
             WHERE o.scan_id = ? AND NOT EXISTS (
               SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
             )`;
  const params = [scan_id];
  if (ssid !== undefined) { sql += ' AND ssid = ?'; params.push(ssid); }
  if (band !== undefined) { sql += ' AND band = ?'; params.push(band); }
  if (minRssi !== undefined) { sql += ' AND rssi >= ?'; params.push(minRssi); }
  sql += ' ORDER BY rssi DESC';
  return withBssidNames(getDb().prepare(sql).all(...params).map((r) => ({
    ...r,
    hidden: !!r.hidden,
    virtual_bssid: !!r.virtual_bssid,
    unreliable_bssid: !!r.unreliable_bssid,
    current: !!r.current,
    capabilities: JSON.parse(r.capabilities ?? '[]'),
  })));
}

// Export CSV : une ligne par observation (points activés ou non, flag inclus).
export function exportPlanCsv(plan_id) {
  return exportCsvFor('sp.plan_id = ?', plan_id, plan_id);
}

export function exportSurveyCsv(survey_id) {
  const survey = getDb().prepare('SELECT plan_id FROM surveys WHERE id = ?').get(survey_id);
  return survey ? exportCsvFor('sp.survey_id = ?', survey_id, survey.plan_id) : null;
}

function exportCsvFor(scope, scope_id) {
  const rows = getDb()
    .prepare(
      `SELECT sp.id AS point_id, sp.x, sp.y, sp.note, sp.is_enabled,
              s.id AS scan_id, s.scanned_at, s.mode,
              s.gateway_ip, s.gateway_rtt_ms, s.gateway_loss_percent,
              st.tcp_down_bps, st.tcp_up_bps,
              o.ssid, o.bssid, br.name AS ap_name, o.rssi, o.quality, o.level, o.band,
              o.frequency_mhz, o.channel, o.security, o.standard
       FROM scan_points sp
       JOIN scans s ON s.scan_point_id = sp.id
       JOIN observations o ON o.scan_id = s.id
       LEFT JOIN bssid_rules br ON br.bssid = o.bssid
       LEFT JOIN speed_tests st ON st.scan_id = s.id
       WHERE ${scope} AND NOT EXISTS (
         SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
       )
       ORDER BY sp.created_at ASC, o.rssi DESC`
    )
    .all(scope_id);
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'point_id', 'x', 'y', 'note', 'enabled', 'scan_id', 'scanned_at', 'mode',
    'gateway_ip', 'gateway_rtt_ms', 'gateway_loss_percent',
    'tcp_down_mbps', 'tcp_up_mbps',
    'ssid', 'bssid', 'ap_name', 'rssi_dbm', 'quality', 'level', 'band',
    'frequency_mhz', 'channel', 'security', 'standard',
  ];
  const toMbps = (bps) =>
    bps === null || bps === undefined ? '' : Math.round((bps / 1_000_000) * 100) / 100;
  const lines = rows.map((r) =>
    [
      r.point_id, r.x, r.y, r.note, r.is_enabled ? 'yes' : 'no',
      r.scan_id, r.scanned_at, r.mode,
      r.gateway_ip, r.gateway_rtt_ms, r.gateway_loss_percent,
      toMbps(r.tcp_down_bps), toMbps(r.tcp_up_bps),
      r.ssid, r.bssid, r.ap_name ?? '',
      r.rssi, r.quality, r.level, r.band,
      r.frequency_mhz, r.channel, r.security, r.standard,
    ]
      .map(cell)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
// Heatmap : meilleur rssi par point (ssid/bssid/réseau connecté en option).
// quality est recalculée depuis ce rssi (même formule que normalizeEntry),
// car MAX(rssi) et MAX(quality) pourraient venir de lignes différentes.
export function heatmapByPlan(plan_id, { ssid, bssid, connected } = {}) {
  return heatmapByScope('sp.plan_id = ?', plan_id, { ssid, bssid, connected });
}

export function heatmapBySurvey(survey_id, { ssid, bssid, connected } = {}) {
  return heatmapByScope('sp.survey_id = ?', survey_id, { ssid, bssid, connected });
}

function heatmapByScope(scope, scope_id, { ssid, bssid, connected } = {}) {
  let sql = `
    SELECT sp.id AS scan_point_id, sp.x, sp.y,
           o.bssid, o.ssid, MAX(o.rssi) AS rssi
    FROM scan_points sp
    JOIN scans s ON s.scan_point_id = sp.id
    JOIN observations o ON o.scan_id = s.id
    WHERE ${scope} AND sp.is_enabled = 1
      AND NOT EXISTS (
        SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
      )`;
  const params = [scope_id];
  if (ssid) { sql += ' AND o.ssid = ?'; params.push(ssid); }
  if (bssid) { sql += ' AND o.bssid = ?'; params.push(bssid?.toLowerCase()); }
  if (connected) { sql += ' AND o.current = 1'; }
  sql += ' GROUP BY sp.id, o.bssid ORDER BY sp.created_at ASC';
  return withBssidNames(getDb().prepare(sql).all(...params).map((r) => ({
    ...r,
    quality: rssiToQuality(r.rssi),
  })));
}
