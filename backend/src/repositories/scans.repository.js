import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';

// Sauve un scan complet (déjà normalisé) + ses observations en transaction.
export function insertScanWithObservations({ scan_point_id, plan_id, mode, scanned_at, rejected_count, entries }) {
  const db = getDb();
  const scan_id = randomUUID();
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO scans (id, scan_point_id, plan_id, mode, scanned_at, rejected_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(scan_id, scan_point_id, plan_id, mode, scanned_at, rejected_count);

    const stmt = db.prepare(
      `INSERT INTO observations
        (scan_id, bssid, ssid, hidden, band, frequency_mhz, channel, bandwidth_mhz,
         center_frequency_mhz, center_channel, rssi, quality, level, security,
         standard, virtual_bssid, capabilities, timestamp_us)
       VALUES (@scan_id, @bssid, @ssid, @hidden, @band, @frequency_mhz, @channel,
         @bandwidth_mhz, @center_frequency_mhz, @center_channel, @rssi, @quality,
         @level, @security, @standard, @virtual_bssid, @capabilities, @timestamp_us)`
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
  return getDb()
    .prepare('SELECT COUNT(*) AS count FROM observations WHERE scan_id = ?')
    .get(scan_id).count;
}

// Historique d'un plan : points + leurs scans + nombre de réseaux par scan
export function getHistoryByPlan(plan_id) {
  const db = getDb();
  const points = db
    .prepare('SELECT * FROM scan_points WHERE plan_id = ? ORDER BY created_at ASC')
    .all(plan_id);
  return points.map((p) => {
    const scans = db
      .prepare('SELECT * FROM scans WHERE scan_point_id = ? ORDER BY created_at ASC')
      .all(p.id);
    return {
      ...p,
      scans: scans.map((s) => ({
        ...s,
        network_count: db
          .prepare('SELECT COUNT(*) AS count FROM observations WHERE scan_id = ?')
          .get(s.id).count,
      })),
    };
  });
}

// Réseaux distincts vus sur un plan (pour les filtres SSID/BSSID)
export function listNetworksByPlan(plan_id) {
  return getDb()
    .prepare(
      `SELECT o.ssid, o.bssid, COUNT(DISTINCT s.id) AS scan_count,
              MAX(o.rssi) AS best_rssi
       FROM observations o
       JOIN scans s ON s.id = o.scan_id
       WHERE s.plan_id = ?
       GROUP BY o.ssid, o.bssid
       ORDER BY best_rssi DESC`
    )
    .all(plan_id);
}

export function listObservationsByScan(scan_id, { ssid, band, minRssi } = {}) {
  let sql = 'SELECT * FROM observations WHERE scan_id = ?';
  const params = [scan_id];
  if (ssid !== undefined) { sql += ' AND ssid = ?'; params.push(ssid); }
  if (band !== undefined) { sql += ' AND band = ?'; params.push(band); }
  if (minRssi !== undefined) { sql += ' AND rssi >= ?'; params.push(minRssi); }
  sql += ' ORDER BY rssi DESC';
  return getDb().prepare(sql).all(...params).map((r) => ({
    ...r,
    hidden: !!r.hidden,
    virtual_bssid: !!r.virtual_bssid,
    capabilities: JSON.parse(r.capabilities ?? '[]'),
  }));
}

// Heatmap : meilleur/dernier rssi par point pour un ssid/bssid donné
export function heatmapByPlan(plan_id, { ssid, bssid } = {}) {
  let sql = `
    SELECT sp.id AS scan_point_id, sp.x, sp.y,
           o.bssid, o.ssid, MAX(o.rssi) AS rssi, MAX(o.quality) AS quality
    FROM scan_points sp
    JOIN scans s ON s.scan_point_id = sp.id
    JOIN observations o ON o.scan_id = s.id
    WHERE sp.plan_id = ?`;
  const params = [plan_id];
  if (ssid) { sql += ' AND o.ssid = ?'; params.push(ssid); }
  if (bssid) { sql += ' AND o.bssid = ?'; params.push(bssid?.toLowerCase()); }
  sql += ' GROUP BY sp.id, o.bssid ORDER BY sp.created_at ASC';
  return getDb().prepare(sql).all(...params);
}
