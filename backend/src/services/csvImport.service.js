import { randomUUID } from 'node:crypto';
import { getDb } from '../database/db.js';
import { insertPlan } from '../repositories/plans.repository.js';
import { insertSurvey } from '../repositories/surveys.repository.js';
import { insertScanPoint } from '../repositories/scanPoints.repository.js';
import { insertScanWithObservations, insertSpeedTest } from '../repositories/scans.repository.js';
import { normalizeEntry } from './scan.services.js';
import { frequencyToBand } from '../utils/wifi.utils.js';

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function parseCsv(content) {
  const text = content.replace(/^\ufeff/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

export function importCsvSurvey(csvContent, options = {}) {
  const rows = parseCsv(csvContent);
  if (rows.length === 0) {
    throw new Error('CSV vide ou invalide');
  }

  const db = getDb();
  const importId = randomUUID();
  const planName = options.planName || `Import CSV ${new Date().toISOString().slice(0, 10)}`;
  const surveyName = options.surveyName || planName;

  // Create a plan (placeholder image) - minimal plan
  const planId = randomUUID();
  db.prepare(
    `INSERT INTO plans (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(planId, planName, 'import.csv', 'import.csv', '/uploads/plans/import.csv', 'image/png', 1000, 1000, 1);

  const survey = insertSurvey({ plan_id: planId, name: surveyName });

  // Group by point
  const pointMap = new Map(); // key by point_id or coordinates
  for (const row of rows) {
    const pointId = row.point_id || `${row.x},${row.y}`;
    if (!pointMap.has(pointId)) {
      const x = parseFloat(row.x);
      const y = parseFloat(row.y);
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      pointMap.set(pointId, {
        id: pointId,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        note: row.note || null,
        enabled: row.enabled === 'yes' || row.enabled === '1' || row.enabled === true,
        scans: new Map(),
      });
    }
  }

  // Group observations by scan
  for (const row of rows) {
    const pointKey = row.point_id || `${row.x},${row.y}`;
    const point = pointMap.get(pointKey);
    if (!point) continue;
    const scanKey = row.scan_id || `${pointKey}-${row.scanned_at || ''}`;
    if (!point.scans.has(scanKey)) {
      point.scans.set(scanKey, {
        id: scanKey,
        scanned_at: row.scanned_at || new Date().toISOString(),
        mode: row.mode || 'test',
        gateway_ip: row.gateway_ip || null,
        gateway_rtt_ms: row.gateway_rtt_ms ? parseFloat(row.gateway_rtt_ms) : null,
        gateway_loss_percent: row.gateway_loss_percent ? parseFloat(row.gateway_loss_percent) : null,
        tcp_down_bps: row.tcp_down_mbps ? Math.round(parseFloat(row.tcp_down_mbps) * 1_000_000) : null,
        tcp_up_bps: row.tcp_up_mbps ? Math.round(parseFloat(row.tcp_up_mbps) * 1_000_000) : null,
        observations: [],
      });
    }
    // Build observation
    const obs = point.scans.get(scanKey);
    const frequency_mhz = row.frequency_mhz ? parseInt(row.frequency_mhz) : null;
    if (!frequency_mhz) continue;
    const band = frequencyToBand(frequency_mhz);
    const entry = {
      bssid: row.bssid || '',
      ssid: row.ssid === 'null' || row.ssid === '' ? '' : row.ssid,
      frequency_mhz,
      rssi: row.rssi_dbm ? parseInt(row.rssi_dbm) : row.rssi ? parseInt(row.rssi) : -70,
      capabilities: row.security ? `[${row.security}]` : '[]',
      channel_bandwidth_mhz: null,
      center_frequency_mhz: null,
      timestamp: null,
    };
    try {
      const normalized = normalizeEntry(entry);
      obs.observations.push(normalized);
    } catch (e) {
      // skip invalid
    }
  }

  // Insert
  const createdPoints = [];
  for (const [, point] of pointMap) {
    const sp = db.prepare(
      `INSERT INTO scan_points (id, plan_id, survey_id, x, y, note, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), planId, survey.id, point.x, point.y, point.note, point.enabled ? 1 : 0);
    // find the inserted point
    const spRow = db.prepare('SELECT * FROM scan_points WHERE rowid = ?').get(sp.lastInsertRowid);
    createdPoints.push({ sp: spRow, point });
  }

  // Insert scans and observations
  for (const { sp, point } of createdPoints) {
    for (const [, scanData] of point.scans) {
      if (scanData.observations.length === 0) continue;
      const scanId = insertScanWithObservations({
        scan_point_id: sp.id,
        plan_id: planId,
        mode: scanData.mode,
        scanned_at: scanData.scanned_at,
        rejected_count: 0,
        gateway: scanData.gateway_ip
          ? { gatewayIp: scanData.gateway_ip, medianRttMs: scanData.gateway_rtt_ms, packetLossPercent: scanData.gateway_loss_percent }
          : null,
        entries: scanData.observations,
      });
      if (scanData.tcp_down_bps !== null || scanData.tcp_up_bps !== null) {
        try {
          insertSpeedTest({
            scan_id: scanId,
            tcp_down_bps: scanData.tcp_down_bps,
            tcp_up_bps: scanData.tcp_up_bps,
            duration_s: 0,
            error: null,
          });
        } catch (e) {
          // ignore
        }
      }
    }
  }

  return { planId, surveyId: survey.id, survey };
}
