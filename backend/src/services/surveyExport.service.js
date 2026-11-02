import { readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { getDb } from '../database/db.js';
import { getPlanExtension, PLANS_DIRECTORY } from './plans.service.js';
import { AppError } from '../utils/AppError.js';

const MAX_SURVEYS = 50;
const COORDINATE_ORIGIN = 'bottom-left';

const placeholders = (count) => Array.from({ length: count }, () => '?').join(', ');

function normalizeSurveyIds(surveyIds) {
  if (!Array.isArray(surveyIds)) {
    throw new AppError('ids doit être une liste de surveys.', 400);
  }
  const ids = [
    ...new Set(surveyIds.map((id) => String(id).trim()).filter(Boolean)),
  ];
  if (ids.length === 0) {
    throw new AppError('Au moins un identifiant de survey est requis.', 400);
  }
  if (ids.length > MAX_SURVEYS) {
    throw new AppError(`Maximum ${MAX_SURVEYS} surveys par export.`, 400);
  }
  return ids;
}

function planExtension(plan) {
  return (
    getPlanExtension(plan.mime) ||
    path.extname(path.basename(plan.stored_file)).replace(/^\./, '') ||
    'bin'
  );
}

function readPlanImage(plan) {
  const filePath = path.join(PLANS_DIRECTORY, path.basename(plan.stored_file));
  try {
    return readFileSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new AppError(`Image du plan introuvable : ${plan.id}`, 422);
    }
    throw error;
  }
}

function loadPlanDetails(db, plan) {
  return {
    id: plan.id,
    name: plan.name,
    file_name: plan.file_name,
    mime: plan.mime,
    width: plan.width,
    height: plan.height,
    size_bytes: plan.size_bytes,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    image: `plans/${plan.id}.${planExtension(plan)}`,
    access_points: db
      .prepare('SELECT * FROM access_points WHERE plan_id = ? ORDER BY created_at ASC, id ASC')
      .all(plan.id),
    ap_positions: db
      .prepare('SELECT * FROM ap_positions WHERE plan_id = ? ORDER BY bssid ASC')
      .all(plan.id),
    polygons: db
      .prepare('SELECT * FROM polygons WHERE plan_id = ? ORDER BY created_at ASC, id ASC')
      .all(plan.id),
    ap_mappings: db
      .prepare('SELECT * FROM ap_mappings WHERE plan_id = ? ORDER BY name ASC, id ASC')
      .all(plan.id),
  };
}

function loadSurveys(db, ids) {
  const rows = db
    .prepare(
      `SELECT id, plan_id, name, created_at, updated_at
       FROM surveys WHERE id IN (${placeholders(ids.length)})`
    )
    .all(...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError(`Surveys introuvables : ${missing.join(', ')}`, 404);
  }

  return ids.map((id) => byId.get(id));
}

function loadScanPoints(db, surveyId) {
  const points = db
    .prepare(
      `SELECT id, plan_id, x, y, note, is_enabled, created_at
       FROM scan_points WHERE survey_id = ? ORDER BY created_at ASC, id ASC`
    )
    .all(surveyId);

  const scansByPoint = db.prepare(
    `SELECT id, scan_point_id, plan_id, mode, scanned_at, rejected_count,
            gateway_ip, gateway_rtt_ms, gateway_loss_percent, created_at
     FROM scans WHERE scan_point_id = ? ORDER BY created_at ASC, id ASC`
  );
  const observationsByScan = db.prepare(
    'SELECT * FROM observations WHERE scan_id = ? ORDER BY id ASC'
  );
  const speedByScan = db.prepare(
    `SELECT tcp_down_bps, tcp_up_bps, duration_s, error, created_at
     FROM speed_tests WHERE scan_id = ?`
  );

  return points.map((point) => ({
    ...point,
    scans: scansByPoint.all(point.id).map((scan) => {
      const observations = observationsByScan.all(scan.id).map((row) => {
        const { id: _id, scan_id: _scanId, ...observation } = row;
        return observation;
      });
      return {
        ...scan,
        observations,
        speed_test: speedByScan.get(scan.id) ?? null,
      };
    }),
  }));
}

export function buildSurveyExportZip(surveyIds) {
  const ids = normalizeSurveyIds(surveyIds);
  const db = getDb();

  const surveys = loadSurveys(db, ids);
  const planIds = [...new Set(surveys.map((survey) => survey.plan_id))];
  const planRows = planIds.length
    ? db
        .prepare(
          `SELECT id, name, file_name, stored_file, mime, width, height, size_bytes,
                  created_at, updated_at
           FROM plans WHERE id IN (${placeholders(planIds.length)})`
        )
        .all(...planIds)
    : [];
  const plansById = new Map(planRows.map((plan) => [plan.id, plan]));

  const files = {};
  const plans = [];
  for (const planId of planIds) {
    const plan = plansById.get(planId);
    if (!plan) continue;
    plans.push(loadPlanDetails(db, plan));
    files[`plans/${plan.id}.${planExtension(plan)}`] = readPlanImage(plan);
  }

  const manifest = {
    format: 'heatmap-survey-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    coordinateOrigin: COORDINATE_ORIGIN,
    plans,
    surveys: surveys.map((survey) => ({
      ...survey,
      scan_points: loadScanPoints(db, survey.id),
    })),
    bssid_rules: db.prepare('SELECT * FROM bssid_rules ORDER BY bssid ASC').all(),
  };

  files['manifest.json'] = new TextEncoder().encode(
    JSON.stringify(manifest, null, 2)
  );

  return zipSync(files);
}
