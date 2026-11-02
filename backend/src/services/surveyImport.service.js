import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { imageSize } from 'image-size';
import { getDb } from '../database/db.js';
import { getPlanExtension, PLANS_DIRECTORY } from './plans.service.js';
import { AppError } from '../utils/AppError.js';

const EXPORT_FORMAT = 'heatmap-survey-export';
const EXPORT_VERSION = 1;
const COORDINATE_ORIGIN = 'bottom-left';
const MAX_ENTRIES = 500;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const fail = (path, message) => {
  throw new AppError(`${path} : ${message}`, 422);
};

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const requireObject = (value, path) => {
  if (!isObject(value)) fail(path, 'objet attendu');
  return value;
};

const requireArray = (value, path) => {
  if (!Array.isArray(value)) fail(path, 'tableau attendu');
  return value;
};

const requireString = (value, path, { allowEmpty = true } = {}) => {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    fail(path, 'chaîne de caractères attendue');
  }
  return value;
};

const requireNullableString = (value, path) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail(path, 'chaîne de caractères ou null attendue');
  return value;
};

const requireNumber = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'nombre attendu');
  }
  return value;
};

const requireInteger = (value, path) => {
  if (!Number.isInteger(value)) fail(path, 'entier attendu');
  return value;
};

const requireNullableInteger = (value, path) => {
  if (value === null || value === undefined) return null;
  return requireInteger(value, path);
};

const requireNullableNumber = (value, path) => {
  if (value === null || value === undefined) return null;
  return requireNumber(value, path);
};

const requirePositiveInteger = (value, path) => {
  const integer = requireInteger(value, path);
  if (integer <= 0) fail(path, 'entier strictement positif attendu');
  return integer;
};

const requireUnitNumber = (value, path) => {
  const number = requireNumber(value, path);
  if (number < 0 || number > 1) fail(path, 'valeur attendue entre 0 et 1');
  return number;
};

const requireIntegerIn = (value, path, min, max) => {
  const integer = requireInteger(value, path);
  if (integer < min || integer > max) {
    fail(path, `valeur attendue entre ${min} et ${max}`);
  }
  return integer;
};

const requireFlag = (value, path) => {
  if (value !== 0 && value !== 1) fail(path, 'valeur attendue 0 ou 1');
  return value;
};

const requireId = (value, path) =>
  requireString(value, path, { allowEmpty: false });

const requireJsonArray = (value, path) => {
  requireString(value, path);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(path, 'JSON invalide');
  }
  if (!Array.isArray(parsed)) fail(path, 'tableau JSON attendu');
  return parsed;
};

const requireBssidList = (value, path) => {
  requireJsonArray(value, path).forEach((entry, index) => {
    if (typeof entry !== 'string') fail(`${path}[${index}]`, 'chaîne attendue');
  });
};

const requireVertices = (value, path) => {
  requireJsonArray(value, path).forEach((vertex, index) => {
    requireObject(vertex, `${path}[${index}]`);
    requireUnitNumber(vertex.x, `${path}[${index}].x`);
    requireUnitNumber(vertex.y, `${path}[${index}].y`);
  });
};

const requireCapabilities = (value, path) => {
  requireJsonArray(value, path).forEach((entry, index) => {
    if (typeof entry !== 'string') fail(`${path}[${index}]`, 'chaîne attendue');
  });
};

const isAllowedEntryName = (name) =>
  name === 'manifest.json' || /^plans\/[^/]+$/.test(name);

function readZipEntries(buffer) {
  let entryCount = 0;
  let totalSize = 0;
  let violated = false;
  const violations = [];

  let entries;
  try {
    entries = unzipSync(buffer, {
      filter(file) {
        if (violated) return false;

        entryCount += 1;
        if (entryCount > MAX_ENTRIES) {
          violations.push(`trop d’entrées dans le ZIP (maximum ${MAX_ENTRIES})`);
          violated = true;
          return false;
        }

        const originalSize = Number(file.originalSize) || 0;
        totalSize += originalSize;
        if (originalSize > MAX_ENTRY_BYTES) {
          violations.push(
            `${file.name} dépasse la taille maximale de ${MAX_ENTRY_BYTES} octets`
          );
          violated = true;
          return false;
        }
        if (totalSize > MAX_TOTAL_BYTES) {
          violations.push(
            `taille décompressée totale supérieure à ${MAX_TOTAL_BYTES} octets`
          );
          violated = true;
          return false;
        }

        const name = file.name;
        if (
          name.includes('..') ||
          name.includes('\\') ||
          name.startsWith('/') ||
          !isAllowedEntryName(name)
        ) {
          violations.push(`nom d’entrée ZIP non autorisé : ${name}`);
          violated = true;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Fichier ZIP invalide.', 400);
  }

  if (violations.length > 0) {
    throw new AppError(violations[0], 400);
  }

  return entries;
}

function validateAccessPoint(point, path, planId) {
  requireObject(point, path);
  requireId(point.id, `${path}.id`);
  if (point.plan_id !== planId) {
    fail(`${path}.plan_id`, 'référence de plan incohérente');
  }
  requireString(point.name, `${path}.name`);
  requireUnitNumber(point.x, `${path}.x`);
  requireUnitNumber(point.y, `${path}.y`);
  requireBssidList(point.bssids, `${path}.bssids`);
  requireString(point.created_at, `${path}.created_at`);
}

function validateApPosition(position, path, planId) {
  requireObject(position, path);
  if (position.plan_id !== planId) {
    fail(`${path}.plan_id`, 'référence de plan incohérente');
  }
  requireString(position.bssid, `${path}.bssid`, { allowEmpty: false });
  requireUnitNumber(position.x, `${path}.x`);
  requireUnitNumber(position.y, `${path}.y`);
  requireString(position.updated_at, `${path}.updated_at`);
}

function validatePolygon(polygon, path, planId) {
  requireObject(polygon, path);
  requireId(polygon.id, `${path}.id`);
  if (polygon.plan_id !== planId) {
    fail(`${path}.plan_id`, 'référence de plan incohérente');
  }
  requireVertices(polygon.vertices, `${path}.vertices`);
  requireString(polygon.created_at, `${path}.created_at`);
  requireString(polygon.updated_at, `${path}.updated_at`);
}

function validateApMapping(mapping, path, planId) {
  requireObject(mapping, path);
  requireId(mapping.id, `${path}.id`);
  if (mapping.plan_id !== planId) {
    fail(`${path}.plan_id`, 'référence de plan incohérente');
  }
  requireString(mapping.name, `${path}.name`);
  requireString(mapping.bssid, `${path}.bssid`, { allowEmpty: false });
  requireString(mapping.created_at, `${path}.created_at`);
}

function validateObservation(observation, path) {
  requireObject(observation, path);
  requireString(observation.bssid, `${path}.bssid`, { allowEmpty: false });
  requireNullableString(observation.ssid, `${path}.ssid`);
  requireFlag(observation.hidden, `${path}.hidden`);
  requireString(observation.band, `${path}.band`, { allowEmpty: false });
  requireInteger(observation.frequency_mhz, `${path}.frequency_mhz`);
  requireNullableInteger(observation.channel, `${path}.channel`);
  requireNullableInteger(observation.bandwidth_mhz, `${path}.bandwidth_mhz`);
  requireNullableInteger(
    observation.center_frequency_mhz,
    `${path}.center_frequency_mhz`
  );
  requireNullableInteger(observation.center_channel, `${path}.center_channel`);
  requireIntegerIn(observation.rssi, `${path}.rssi`, -127, 0);
  requireIntegerIn(observation.quality, `${path}.quality`, 0, 100);
  requireString(observation.level, `${path}.level`);
  requireString(observation.security, `${path}.security`);
  requireString(observation.standard, `${path}.standard`);
  requireFlag(observation.virtual_bssid, `${path}.virtual_bssid`);
  requireFlag(observation.unreliable_bssid, `${path}.unreliable_bssid`);
  requireFlag(observation.current, `${path}.current`);
  requireCapabilities(observation.capabilities, `${path}.capabilities`);
  requireNullableInteger(observation.timestamp_us, `${path}.timestamp_us`);
}

function validateSpeedTest(speedTest, path) {
  if (speedTest === null || speedTest === undefined) return;
  requireObject(speedTest, path);
  requireNullableInteger(speedTest.tcp_down_bps, `${path}.tcp_down_bps`);
  requireNullableInteger(speedTest.tcp_up_bps, `${path}.tcp_up_bps`);
  const duration = requireInteger(speedTest.duration_s, `${path}.duration_s`);
  if (duration < 0) fail(`${path}.duration_s`, 'valeur positive attendue');
  requireNullableString(speedTest.error, `${path}.error`);
  requireString(speedTest.created_at, `${path}.created_at`);
}

function validateScan(scan, path, pointId, planId) {
  requireObject(scan, path);
  requireId(scan.id, `${path}.id`);
  if (scan.scan_point_id !== pointId) {
    fail(`${path}.scan_point_id`, 'référence de point de scan incohérente');
  }
  if (scan.plan_id !== planId) {
    fail(`${path}.plan_id`, 'référence de plan incohérente');
  }
  if (scan.mode !== 'live' && scan.mode !== 'test') {
    fail(`${path}.mode`, 'valeur attendue live ou test');
  }
  requireString(scan.scanned_at, `${path}.scanned_at`);
  const rejected = requireInteger(scan.rejected_count, `${path}.rejected_count`);
  if (rejected < 0) fail(`${path}.rejected_count`, 'valeur positive attendue');
  requireNullableString(scan.gateway_ip, `${path}.gateway_ip`);
  requireNullableNumber(scan.gateway_rtt_ms, `${path}.gateway_rtt_ms`);
  requireNullableNumber(
    scan.gateway_loss_percent,
    `${path}.gateway_loss_percent`
  );
  requireString(scan.created_at, `${path}.created_at`);

  requireArray(scan.observations, `${path}.observations`).forEach(
    (observation, observationIndex) => {
      validateObservation(
        observation,
        `${path}.observations[${observationIndex}]`
      );
    }
  );
  validateSpeedTest(scan.speed_test, `${path}.speed_test`);
}

function validateScanPoint(point, path, surveyId, planId) {
  requireObject(point, path);
  requireId(point.id, `${path}.id`);
  if (point.plan_id !== planId) {
    fail(`${path}.plan_id`, 'référence de plan incohérente');
  }
  if (point.survey_id !== undefined && point.survey_id !== surveyId) {
    fail(`${path}.survey_id`, 'référence de survey incohérente');
  }
  requireUnitNumber(point.x, `${path}.x`);
  requireUnitNumber(point.y, `${path}.y`);
  requireNullableString(point.note, `${path}.note`);
  requireFlag(point.is_enabled, `${path}.is_enabled`);
  requireString(point.created_at, `${path}.created_at`);

  requireArray(point.scans, `${path}.scans`).forEach((scan, scanIndex) => {
    validateScan(scan, `${path}.scans[${scanIndex}]`, point.id, planId);
  });
}

function validateBssidRule(rule, path) {
  requireObject(rule, path);
  requireId(rule.id, `${path}.id`);
  requireString(rule.bssid, `${path}.bssid`, { allowEmpty: false });
  requireString(rule.name, `${path}.name`);
  requireFlag(rule.blacklisted, `${path}.blacklisted`);
  requireString(rule.created_at, `${path}.created_at`);
}

function validatePlan(plan, path, entries, images) {
  requireObject(plan, path);
  requireId(plan.id, `${path}.id`);
  requireString(plan.name, `${path}.name`);
  requireString(plan.file_name, `${path}.file_name`);
  if (!MIME_IMAGE_TYPES.has(plan.mime)) {
    fail(`${path}.mime`, 'type MIME non supporté');
  }
  requirePositiveInteger(plan.width, `${path}.width`);
  requirePositiveInteger(plan.height, `${path}.height`);
  requirePositiveInteger(plan.size_bytes, `${path}.size_bytes`);
  requireString(plan.created_at, `${path}.created_at`);
  requireString(plan.updated_at, `${path}.updated_at`);
  requireString(plan.image, `${path}.image`, { allowEmpty: false });
  if (!isAllowedEntryName(plan.image)) {
    fail(`${path}.image`, 'chemin d’image non autorisé');
  }

  const imageEntry = entries[plan.image];
  if (!imageEntry) fail(`${path}.image`, 'image absente du ZIP');
  const imageBuffer = Buffer.from(imageEntry);

  let dimensions;
  try {
    dimensions = imageSize(imageBuffer);
  } catch {
    fail(`${path}.image`, 'image illisible');
  }
  const expectedType = MIME_IMAGE_TYPES.get(plan.mime);
  if (dimensions.type !== expectedType) {
    fail(`${path}.image`, 'type d’image incohérent avec le manifest');
  }
  if (
    dimensions.width !== plan.width ||
    dimensions.height !== plan.height
  ) {
    fail(`${path}.image`, 'dimensions incohérentes avec le manifest');
  }
  images.set(plan.id, imageBuffer);

  const accessPointNames = new Set();
  requireArray(plan.access_points, `${path}.access_points`).forEach(
    (accessPoint, index) => {
      const accessPointPath = `${path}.access_points[${index}]`;
      validateAccessPoint(accessPoint, accessPointPath, plan.id);
      if (accessPointNames.has(accessPoint.name)) {
        fail(`${accessPointPath}.name`, 'nom dupliqué');
      }
      accessPointNames.add(accessPoint.name);
    }
  );
  const apPositionBssids = new Set();
  requireArray(plan.ap_positions, `${path}.ap_positions`).forEach(
    (position, index) => {
      const positionPath = `${path}.ap_positions[${index}]`;
      validateApPosition(position, positionPath, plan.id);
      if (apPositionBssids.has(position.bssid)) {
        fail(`${positionPath}.bssid`, 'BSSID dupliqué');
      }
      apPositionBssids.add(position.bssid);
    }
  );
  requireArray(plan.polygons, `${path}.polygons`).forEach((polygon, index) => {
    validatePolygon(polygon, `${path}.polygons[${index}]`, plan.id);
  });
  const apMappingBssids = new Set();
  requireArray(plan.ap_mappings, `${path}.ap_mappings`).forEach(
    (mapping, index) => {
      const mappingPath = `${path}.ap_mappings[${index}]`;
      validateApMapping(mapping, mappingPath, plan.id);
      if (apMappingBssids.has(mapping.bssid)) {
        fail(`${mappingPath}.bssid`, 'BSSID dupliqué');
      }
      apMappingBssids.add(mapping.bssid);
    }
  );
}

function validateManifest(manifest, entries) {
  if (!isObject(manifest)) fail('manifest', 'objet attendu');
  if (manifest.format !== EXPORT_FORMAT) {
    fail('format', `valeur attendue ${EXPORT_FORMAT}`);
  }
  if (manifest.version !== EXPORT_VERSION) {
    throw new AppError(`version non supportée : ${manifest.version}`, 422);
  }
  if (manifest.coordinateOrigin !== COORDINATE_ORIGIN) {
    fail('coordinateOrigin', `valeur attendue ${COORDINATE_ORIGIN}`);
  }

  const images = new Map();
  const planIds = new Set();
  const accessPointIds = new Set();
  const polygonIds = new Set();
  const plans = requireArray(manifest.plans, 'plans');
  plans.forEach((plan, planIndex) => {
    const path = `plans[${planIndex}]`;
    validatePlan(plan, path, entries, images);
    if (planIds.has(plan.id)) fail(`${path}.id`, 'identifiant dupliqué');
    planIds.add(plan.id);
    plan.access_points.forEach((accessPoint, index) => {
      const accessPointPath = `${path}.access_points[${index}]`;
      if (accessPointIds.has(accessPoint.id)) {
        fail(`${accessPointPath}.id`, 'identifiant dupliqué');
      }
      accessPointIds.add(accessPoint.id);
    });
    plan.polygons.forEach((polygon, index) => {
      const polygonPath = `${path}.polygons[${index}]`;
      if (polygonIds.has(polygon.id)) {
        fail(`${polygonPath}.id`, 'identifiant dupliqué');
      }
      polygonIds.add(polygon.id);
    });
  });

  const surveyIds = new Set();
  const pointIds = new Set();
  const scanIds = new Set();
  const surveys = requireArray(manifest.surveys, 'surveys');
  surveys.forEach((survey, surveyIndex) => {
    const path = `surveys[${surveyIndex}]`;
    requireObject(survey, path);
    requireId(survey.id, `${path}.id`);
    if (surveyIds.has(survey.id)) fail(`${path}.id`, 'identifiant dupliqué');
    surveyIds.add(survey.id);
    if (!planIds.has(survey.plan_id)) {
      fail(`${path}.plan_id`, 'référence de plan inconnue');
    }
    requireString(survey.name, `${path}.name`);
    requireString(survey.created_at, `${path}.created_at`);
    requireString(survey.updated_at, `${path}.updated_at`);

    requireArray(survey.scan_points, `${path}.scan_points`).forEach(
      (point, pointIndex) => {
        const pointPath = `${path}.scan_points[${pointIndex}]`;
        validateScanPoint(point, pointPath, survey.id, survey.plan_id);
        if (pointIds.has(point.id)) fail(`${pointPath}.id`, 'identifiant dupliqué');
        pointIds.add(point.id);
        point.scans.forEach((scan, scanIndex) => {
          const scanPath = `${pointPath}.scans[${scanIndex}]`;
          if (scanIds.has(scan.id)) fail(`${scanPath}.id`, 'identifiant dupliqué');
          scanIds.add(scan.id);
        });
      }
    );
  });

  const bssids = new Set();
  requireArray(manifest.bssid_rules, 'bssid_rules').forEach((rule, index) => {
    const path = `bssid_rules[${index}]`;
    validateBssidRule(rule, path);
    const bssid = rule.bssid.toLowerCase();
    if (bssids.has(bssid)) fail(`${path}.bssid`, 'BSSID dupliqué');
    bssids.add(bssid);
  });

  return images;
}

export function parseSurveyExportZip(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new AppError('Contenu ZIP invalide.', 400);
  }

  const entries = readZipEntries(buffer);
  const manifestEntry = entries['manifest.json'];
  if (!manifestEntry) {
    throw new AppError('manifest.json manquant dans le ZIP.', 422);
  }

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestEntry));
  } catch {
    throw new AppError('manifest.json invalide.', 422);
  }

  const images = validateManifest(manifest, entries);
  return { manifest, images };
}

function existingIds(table, ids) {
  const existing = new Set();
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return existing;

  const db = getDb();
  const chunkSize = 500;
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const chunk = uniqueIds.slice(index, index + chunkSize);
    const placeholders = Array.from({ length: chunk.length }, () => '?').join(', ');
    const rows = db
      .prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders})`)
      .all(...chunk);
    for (const row of rows) existing.add(row.id);
  }
  return existing;
}

export function previewSurveyImport({ manifest }) {
  const planIds = existingIds(
    'plans',
    manifest.plans.map((plan) => plan.id)
  );
  const surveyIds = existingIds(
    'surveys',
    manifest.surveys.map((survey) => survey.id)
  );

  const surveyCountByPlan = new Map();
  for (const survey of manifest.surveys) {
    surveyCountByPlan.set(
      survey.plan_id,
      (surveyCountByPlan.get(survey.plan_id) ?? 0) + 1
    );
  }

  return {
    plans: manifest.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      existsOnDevice: planIds.has(plan.id),
      surveyCount: surveyCountByPlan.get(plan.id) ?? 0,
    })),
    surveys: manifest.surveys.map((survey) => {
      let observationCount = 0;
      for (const point of survey.scan_points) {
        for (const scan of point.scans) {
          observationCount += scan.observations.length;
        }
      }
      return {
        id: survey.id,
        name: survey.name,
        planId: survey.plan_id,
        existsOnDevice: surveyIds.has(survey.id),
        scanPointCount: survey.scan_points.length,
        observationCount,
      };
    }),
    bssidRuleCount: manifest.bssid_rules.length,
  };
}

export function executeSurveyImport({ manifest, images }, resolutions = {}) {
  const db = getDb();
  const requestedResolutions =
    resolutions !== null && typeof resolutions === 'object' && !Array.isArray(resolutions)
      ? resolutions
      : {};

  const existingPlanIds = existingIds(
    'plans',
    manifest.plans.map((plan) => plan.id)
  );
  const unresolvedPlanIds = manifest.plans
    .filter(
      (plan) =>
        existingPlanIds.has(plan.id) &&
        requestedResolutions[plan.id] !== 'merge' &&
        requestedResolutions[plan.id] !== 'duplicate'
    )
    .map((plan) => plan.id);
  if (unresolvedPlanIds.length > 0) {
    const error = new AppError(
      'Résolution requise pour les plans existants.',
      409,
      { code: 'RESOLUTION_REQUIRED', planIds: unresolvedPlanIds }
    );
    error.code = 'RESOLUTION_REQUIRED';
    throw error;
  }

  const surveysByPlan = new Map();
  for (const survey of manifest.surveys) {
    if (!surveysByPlan.has(survey.plan_id)) surveysByPlan.set(survey.plan_id, []);
    surveysByPlan.get(survey.plan_id).push(survey);
  }

  const insertPlan = db.prepare(
    `INSERT INTO plans (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAccessPoint = db.prepare(
    `INSERT INTO access_points (id, plan_id, name, x, y, bssids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAccessPointIgnore = db.prepare(
    `INSERT OR IGNORE INTO access_points (id, plan_id, name, x, y, bssids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertApPosition = db.prepare(
    `INSERT INTO ap_positions (plan_id, bssid, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertApPositionIgnore = db.prepare(
    `INSERT OR IGNORE INTO ap_positions (plan_id, bssid, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertPolygon = db.prepare(
    `INSERT INTO polygons (id, plan_id, vertices, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertPolygonIgnore = db.prepare(
    `INSERT OR IGNORE INTO polygons (id, plan_id, vertices, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertApMapping = db.prepare(
    `INSERT INTO ap_mappings (id, plan_id, name, bssid, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertApMappingIgnore = db.prepare(
    `INSERT OR IGNORE INTO ap_mappings (id, plan_id, name, bssid, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertSurvey = db.prepare(
    `INSERT INTO surveys (id, plan_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const findSurvey = db.prepare('SELECT 1 FROM surveys WHERE id = ?');
  const insertScanPoint = db.prepare(
    `INSERT INTO scan_points (id, plan_id, survey_id, x, y, note, is_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const findScanPoint = db.prepare('SELECT 1 FROM scan_points WHERE id = ?');
  const insertScan = db.prepare(
    `INSERT INTO scans (id, scan_point_id, plan_id, mode, scanned_at, rejected_count,
                        gateway_ip, gateway_rtt_ms, gateway_loss_percent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const findScan = db.prepare('SELECT 1 FROM scans WHERE id = ?');
  const insertObservation = db.prepare(
    `INSERT INTO observations
      (scan_id, bssid, ssid, hidden, band, frequency_mhz, channel, bandwidth_mhz,
       center_frequency_mhz, center_channel, rssi, quality, level, security,
       standard, virtual_bssid, unreliable_bssid, current, capabilities, timestamp_us)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSpeedTest = db.prepare(
    `INSERT INTO speed_tests (scan_id, tcp_down_bps, tcp_up_bps, duration_s, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertBssidRule = db.prepare(
    `INSERT OR IGNORE INTO bssid_rules (id, bssid, name, blacklisted, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const findBssidRule = db.prepare(
    'SELECT 1 FROM bssid_rules WHERE lower(bssid) = ?'
  );
  const findId = {
    surveys: db.prepare('SELECT 1 FROM surveys WHERE id = ?'),
    scan_points: db.prepare('SELECT 1 FROM scan_points WHERE id = ?'),
    scans: db.prepare('SELECT 1 FROM scans WHERE id = ?'),
    access_points: db.prepare('SELECT 1 FROM access_points WHERE id = ?'),
    polygons: db.prepare('SELECT 1 FROM polygons WHERE id = ?'),
    ap_mappings: db.prepare('SELECT 1 FROM ap_mappings WHERE id = ?'),
  };

  const identity = (id) => id;
  const identityIdOf = {
    survey: identity,
    point: identity,
    scan: identity,
  };
  const randomIdOf = {
    survey: () => randomUUID(),
    point: () => randomUUID(),
    scan: () => randomUUID(),
  };
  const randomPlanIds = {
    accessPoint: () => randomUUID(),
    polygon: () => randomUUID(),
    mapping: () => randomUUID(),
  };

  const assertIdAvailable = (table, id) => {
    if (findId[table].get(id)) {
      throw new AppError(`Conflit d'id : ${table} ${id} déjà utilisé`, 409);
    }
  };

  const assertPlanIdsAvailable = (plan) => {
    for (const survey of surveysByPlan.get(plan.id) ?? []) {
      assertIdAvailable('surveys', survey.id);
      for (const point of survey.scan_points) {
        assertIdAvailable('scan_points', point.id);
        for (const scan of point.scans) {
          assertIdAvailable('scans', scan.id);
        }
      }
    }
    for (const accessPoint of plan.access_points) {
      assertIdAvailable('access_points', accessPoint.id);
    }
    for (const polygon of plan.polygons) {
      assertIdAvailable('polygons', polygon.id);
    }
    for (const mapping of plan.ap_mappings) {
      assertIdAvailable('ap_mappings', mapping.id);
    }
  };

  const insertPlanLevel = (plan, planId, { ignore = false, ids = {} } = {}) => {
    const accessPointId = ids.accessPoint ?? identity;
    const polygonId = ids.polygon ?? identity;
    const mappingId = ids.mapping ?? identity;
    const accessPointStatement = ignore ? insertAccessPointIgnore : insertAccessPoint;
    const apPositionStatement = ignore ? insertApPositionIgnore : insertApPosition;
    const polygonStatement = ignore ? insertPolygonIgnore : insertPolygon;
    const apMappingStatement = ignore ? insertApMappingIgnore : insertApMapping;

    for (const accessPoint of plan.access_points) {
      accessPointStatement.run(
        accessPointId(accessPoint.id),
        planId,
        accessPoint.name,
        accessPoint.x,
        accessPoint.y,
        accessPoint.bssids,
        accessPoint.created_at
      );
    }
    for (const position of plan.ap_positions) {
      apPositionStatement.run(
        planId,
        position.bssid,
        position.x,
        position.y,
        position.updated_at
      );
    }
    for (const polygon of plan.polygons) {
      polygonStatement.run(
        polygonId(polygon.id),
        planId,
        polygon.vertices,
        polygon.created_at,
        polygon.updated_at
      );
    }
    for (const mapping of plan.ap_mappings) {
      apMappingStatement.run(
        mappingId(mapping.id),
        planId,
        mapping.name,
        mapping.bssid,
        mapping.created_at
      );
    }
  };

  const insertSurveyTree = (survey, planId, idOf) => {
    const surveyId = idOf.survey(survey.id);
    insertSurvey.run(
      surveyId,
      planId,
      survey.name,
      survey.created_at,
      survey.updated_at
    );

    let scanPointCount = 0;
    let scanCount = 0;
    let observationCount = 0;

    for (const point of survey.scan_points) {
      const pointId = idOf.point(point.id);
      insertScanPoint.run(
        pointId,
        planId,
        surveyId,
        point.x,
        point.y,
        point.note ?? null,
        point.is_enabled,
        point.created_at
      );
      scanPointCount += 1;

      for (const scan of point.scans) {
        const scanId = idOf.scan(scan.id);
        insertScan.run(
          scanId,
          pointId,
          planId,
          scan.mode,
          scan.scanned_at,
          scan.rejected_count,
          scan.gateway_ip ?? null,
          scan.gateway_rtt_ms ?? null,
          scan.gateway_loss_percent ?? null,
          scan.created_at
        );
        scanCount += 1;

        for (const observation of scan.observations) {
          insertObservation.run(
            scanId,
            observation.bssid,
            observation.ssid ?? null,
            observation.hidden,
            observation.band,
            observation.frequency_mhz,
            observation.channel ?? null,
            observation.bandwidth_mhz ?? null,
            observation.center_frequency_mhz ?? null,
            observation.center_channel ?? null,
            observation.rssi,
            observation.quality,
            observation.level,
            observation.security,
            observation.standard,
            observation.virtual_bssid,
            observation.unreliable_bssid,
            observation.current,
            observation.capabilities,
            observation.timestamp_us ?? null
          );
          observationCount += 1;
        }

        if (scan.speed_test) {
          insertSpeedTest.run(
            scanId,
            scan.speed_test.tcp_down_bps ?? null,
            scan.speed_test.tcp_up_bps ?? null,
            scan.speed_test.duration_s,
            scan.speed_test.error ?? null,
            scan.speed_test.created_at
          );
        }
      }
    }

    return {
      surveyId,
      scanPoints: scanPointCount,
      scans: scanCount,
      observations: observationCount,
    };
  };

  const writtenFiles = [];
  try {
    mkdirSync(PLANS_DIRECTORY, { recursive: true });
    return db.transaction(() => {
      let plansCreated = 0;
      let plansMerged = 0;
      let scanPoints = 0;
      let scans = 0;
      let observations = 0;
      let bssidRulesAdded = 0;
      const importedSurveys = [];
      const skippedSurveys = [];

      for (const plan of manifest.plans) {
        const image = images.get(plan.id);
        if (!image) {
          throw new AppError(`Image du plan manquante : ${plan.id}`, 422);
        }
        if (image.length > MAX_IMPORT_IMAGE_BYTES) {
          throw new AppError('Cette image dépasse la limite de 10 Mo.', 413);
        }

        const resolution = existingPlanIds.has(plan.id)
          ? requestedResolutions[plan.id]
          : null;
        const merge = resolution === 'merge';

        if (merge) {
          plansMerged += 1;
          insertPlanLevel(plan, plan.id, { ignore: true });

          for (const survey of surveysByPlan.get(plan.id) ?? []) {
            if (findSurvey.get(survey.id)) {
              skippedSurveys.push({
                id: survey.id,
                name: survey.name,
                reason: 'already_exists',
              });
              continue;
            }

            for (const point of survey.scan_points) {
              if (findScanPoint.get(point.id)) {
                throw new AppError(
                  `Conflit d’id : point de scan ${point.id} déjà utilisé.`,
                  409
                );
              }
              for (const scan of point.scans) {
                if (findScan.get(scan.id)) {
                  throw new AppError(
                    `Conflit d’id : scan ${scan.id} déjà utilisé.`,
                    409
                  );
                }
              }
            }

            const tree = insertSurveyTree(survey, plan.id, identityIdOf);
            importedSurveys.push({ id: tree.surveyId, name: survey.name });
            scanPoints += tree.scanPoints;
            scans += tree.scans;
            observations += tree.observations;
          }
        } else {
          const duplicate = resolution === 'duplicate';
          const targetPlanId = duplicate ? randomUUID() : plan.id;
          const idOf = duplicate ? randomIdOf : identityIdOf;

          if (!duplicate) {
            assertPlanIdsAvailable(plan);
          }

          const extension = getPlanExtension(plan.mime);
          const storedFile = `${randomUUID()}.${extension}`;
          const filePath = path.join(PLANS_DIRECTORY, storedFile);
          writeFileSync(filePath, image);
          writtenFiles.push(filePath);

          insertPlan.run(
            targetPlanId,
            duplicate ? `${plan.name} (copie)` : plan.name,
            plan.file_name,
            storedFile,
            `/uploads/plans/${storedFile}`,
            plan.mime,
            plan.width,
            plan.height,
            image.length
          );
          plansCreated += 1;

          insertPlanLevel(
            plan,
            targetPlanId,
            duplicate ? { ids: randomPlanIds } : {}
          );

          for (const survey of surveysByPlan.get(plan.id) ?? []) {
            const tree = insertSurveyTree(survey, targetPlanId, idOf);
            importedSurveys.push({ id: tree.surveyId, name: survey.name });
            scanPoints += tree.scanPoints;
            scans += tree.scans;
            observations += tree.observations;
          }
        }
      }

      for (const rule of manifest.bssid_rules) {
        const bssid = rule.bssid.toLowerCase();
        if (findBssidRule.get(bssid)) continue;
        const result = insertBssidRule.run(
          rule.id,
          bssid,
          rule.name,
          rule.blacklisted,
          rule.created_at
        );
        if (result.changes > 0) bssidRulesAdded += 1;
      }

      return {
        importedSurveys,
        skippedSurveys,
        plansCreated,
        plansMerged,
        scanPoints,
        scans,
        observations,
        bssidRulesAdded,
      };
    })();
  } catch (error) {
    for (const filePath of writtenFiles) {
      try {
        unlinkSync(filePath);
      } catch {}
    }
    if (error instanceof AppError) throw error;
    if (String(error?.code).startsWith('SQLITE_CONSTRAINT')) {
      throw new AppError(`données incohérentes : ${error.message}`, 422);
    }
    throw error;
  }
}
