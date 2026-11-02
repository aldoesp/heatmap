import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';

const TMP = mkdtempSync(path.join(tmpdir(), 'heatmap-survey-export-test-'));
process.env.DB_PATH = path.join(TMP, 'test.db');

const { AppError } = await import('../src/utils/AppError.js');
const { getDb, closeDb } = await import('../src/database/db.js');
const { PLANS_DIRECTORY } = await import('../src/services/plans.service.js');
const { buildSurveyExportZip } = await import('../src/services/surveyExport.service.js');
const { parseSurveyExportZip, executeSurveyImport } = await import(
  '../src/services/surveyImport.service.js'
);

const TABLES = [
  'plans',
  'surveys',
  'scan_points',
  'scans',
  'observations',
  'speed_tests',
  'access_points',
  'ap_positions',
  'polygons',
  'ap_mappings',
  'bssid_rules',
];

mkdirSync(PLANS_DIRECTORY, { recursive: true });
const INITIAL_PLAN_FILES = readdirSync(PLANS_DIRECTORY).sort();

function makePng(width = 2, height = 2) {
  const raw = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x99)])
    )
  );
  const compressed = deflateSync(raw);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function listPlanFiles() {
  return readdirSync(PLANS_DIRECTORY).sort();
}

function removeStoredPlanFiles(db) {
  for (const { stored_file: storedFile } of db
    .prepare('SELECT stored_file FROM plans')
    .all()) {
    try {
      unlinkSync(path.join(PLANS_DIRECTORY, path.basename(storedFile)));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function clearDatabase() {
  const db = getDb();
  removeStoredPlanFiles(db);
  db.prepare('DELETE FROM bssid_rules').run();
  db.prepare('DELETE FROM plans').run();
}

function databaseFingerprint() {
  const db = getDb();
  return JSON.stringify(
    TABLES.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ])
  );
}

function createFixture() {
  const db = getDb();
  const image = makePng();
  const planId = randomUUID();
  const storedFile = `${randomUUID()}.png`;
  const surveyId = randomUUID();
  const pointIds = [randomUUID(), randomUUID(), randomUUID()];
  const scanIds = [randomUUID(), randomUUID()];
  const accessPointId = randomUUID();
  const polygonId = randomUUID();
  const mappingId = randomUUID();
  const ruleIds = [randomUUID(), randomUUID()];
  const bssid = 'aa:bb:cc:dd:ee:01';
  const vertices = [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.5, y: 0.9 },
  ];

  writeFileSync(path.join(PLANS_DIRECTORY, storedFile), image);

  db.prepare(
    `INSERT INTO plans
      (id, name, file_name, stored_file, image_url, mime, width, height,
       size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    planId,
    'Plan export test',
    'source.png',
    storedFile,
    `/uploads/plans/${storedFile}`,
    'image/png',
    2,
    2,
    image.length,
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z'
  );

  db.prepare(
    `INSERT INTO access_points
      (id, plan_id, name, x, y, bssids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(accessPointId, planId, 'AP test', 0.3, 0.7, JSON.stringify([bssid]), '2026-01-01T10:00:00.000Z');

  db.prepare(
    `INSERT INTO ap_positions (plan_id, bssid, x, y, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(planId, bssid, 0.35, 0.65, '2026-01-01T10:00:00.000Z');

  db.prepare(
    `INSERT INTO polygons (id, plan_id, vertices, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    polygonId,
    planId,
    JSON.stringify(vertices),
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z'
  );

  db.prepare(
    `INSERT INTO ap_mappings (id, plan_id, name, bssid, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(mappingId, planId, 'Borne test', bssid, '2026-01-01T10:00:00.000Z');

  db.prepare(
    `INSERT INTO surveys (id, plan_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    surveyId,
    planId,
    'Campagne export',
    '2026-01-01T10:00:00.000Z',
    '2026-01-01T10:00:00.000Z'
  );

  const insertPoint = db.prepare(
    `INSERT INTO scan_points
      (id, plan_id, survey_id, x, y, note, is_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertPoint.run(pointIds[0], planId, surveyId, 0.1, 0.2, 'premier point', 1, '2026-01-01T10:01:00.000Z');
  insertPoint.run(pointIds[1], planId, surveyId, 0.5, 0.6, null, 1, '2026-01-01T10:02:00.000Z');
  insertPoint.run(pointIds[2], planId, surveyId, 0.9, 0.8, 'point désactivé', 0, '2026-01-01T10:03:00.000Z');

  const insertScan = db.prepare(
    `INSERT INTO scans
      (id, scan_point_id, plan_id, mode, scanned_at, rejected_count,
       gateway_ip, gateway_rtt_ms, gateway_loss_percent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertScan.run(
    scanIds[0],
    pointIds[0],
    planId,
    'test',
    '2026-01-01T10:05:00.000Z',
    1,
    '192.168.1.1',
    2.5,
    0,
    '2026-01-01T10:05:00.000Z'
  );
  insertScan.run(
    scanIds[1],
    pointIds[1],
    planId,
    'live',
    '2026-01-01T10:06:00.000Z',
    0,
    null,
    null,
    null,
    '2026-01-01T10:06:00.000Z'
  );

  const insertObservation = db.prepare(
    `INSERT INTO observations
      (scan_id, bssid, ssid, hidden, band, frequency_mhz, channel, bandwidth_mhz,
       center_frequency_mhz, center_channel, rssi, quality, level, security,
       standard, virtual_bssid, unreliable_bssid, current, capabilities, timestamp_us)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const observation = (scanId, bssidValue, ssid, rssi) => {
    insertObservation.run(
      scanId,
      bssidValue,
      ssid,
      0,
      '5GHz',
      5180,
      36,
      80,
      5210,
      42,
      rssi,
      90,
      'excellent',
      'WPA2',
      'wifi5 (802.11ac)',
      0,
      0,
      0,
      JSON.stringify(['ESS']),
      123456789
    );
  };
  observation(scanIds[0], 'aa:bb:cc:dd:ee:01', 'Reseau-A', -42);
  observation(scanIds[0], 'aa:bb:cc:dd:ee:02', 'Reseau-B', -70);
  observation(scanIds[1], 'aa:bb:cc:dd:ee:03', 'Reseau-C', -55);
  observation(scanIds[1], 'aa:bb:cc:dd:ee:04', 'Reseau-D', -80);

  db.prepare(
    `INSERT INTO speed_tests
      (scan_id, tcp_down_bps, tcp_up_bps, duration_s, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(scanIds[0], 100000000, 50000000, 5, null, '2026-01-01T10:05:00.000Z');

  const insertRule = db.prepare(
    `INSERT INTO bssid_rules (id, bssid, name, blacklisted, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertRule.run(ruleIds[0], bssid, 'Borne test', 0, '2026-01-01T10:00:00.000Z');
  insertRule.run(ruleIds[1], 'aa:bb:cc:dd:ee:02', 'Reseau exclu', 1, '2026-01-01T10:00:00.000Z');

  return {
    planId,
    surveyId,
    pointIds,
    scanIds,
    accessPointId,
    polygonId,
    mappingId,
    ruleIds,
    storedFile,
    vertices,
  };
}

function readBssidRules() {
  return getDb()
    .prepare('SELECT * FROM bssid_rules ORDER BY bssid')
    .all();
}

function readPlanState(planId) {
  const db = getDb();
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  const surveys = db
    .prepare('SELECT * FROM surveys WHERE plan_id = ? ORDER BY id')
    .all(planId);
  const scanPoints = db
    .prepare('SELECT * FROM scan_points WHERE plan_id = ? ORDER BY id')
    .all(planId);
  const scans = db
    .prepare('SELECT * FROM scans WHERE plan_id = ? ORDER BY id')
    .all(planId);
  const observations = db
    .prepare(
      `SELECT o.bssid, o.ssid, o.hidden, o.band, o.frequency_mhz, o.channel,
              o.bandwidth_mhz, o.center_frequency_mhz, o.center_channel, o.rssi,
              o.quality, o.level, o.security, o.standard, o.virtual_bssid,
              o.unreliable_bssid, o.current, o.capabilities, o.timestamp_us
       FROM observations o
       JOIN scans s ON s.id = o.scan_id
       WHERE s.plan_id = ?
       ORDER BY o.id`
    )
    .all(planId);
  const speedTests = db
    .prepare(
      `SELECT st.tcp_down_bps, st.tcp_up_bps, st.duration_s, st.error, st.created_at
       FROM speed_tests st
       JOIN scans s ON s.id = st.scan_id
       WHERE s.plan_id = ?
       ORDER BY st.id`
    )
    .all(planId);
  const accessPoints = db
    .prepare('SELECT * FROM access_points WHERE plan_id = ? ORDER BY id')
    .all(planId);
  const apPositions = db
    .prepare('SELECT * FROM ap_positions WHERE plan_id = ? ORDER BY bssid')
    .all(planId);
  const polygons = db
    .prepare('SELECT * FROM polygons WHERE plan_id = ? ORDER BY id')
    .all(planId);
  const apMappings = db
    .prepare('SELECT * FROM ap_mappings WHERE plan_id = ? ORDER BY id')
    .all(planId);

  return {
    plan,
    surveys,
    scanPoints,
    scans,
    observations,
    speedTests,
    accessPoints,
    apPositions,
    polygons,
    apMappings,
    counts: {
      surveys: surveys.length,
      scanPoints: scanPoints.length,
      scans: scans.length,
      observations: observations.length,
      speedTests: speedTests.length,
      accessPoints: accessPoints.length,
      apPositions: apPositions.length,
      polygons: polygons.length,
      apMappings: apMappings.length,
    },
  };
}

function idsOfPlanState(state) {
  return new Set([
    state.plan.id,
    ...state.surveys.map((row) => row.id),
    ...state.scanPoints.map((row) => row.id),
    ...state.scans.map((row) => row.id),
    ...state.accessPoints.map((row) => row.id),
    ...state.polygons.map((row) => row.id),
    ...state.apMappings.map((row) => row.id),
  ]);
}

function comparablePlanFields(plan) {
  return {
    id: plan.id,
    name: plan.name,
    file_name: plan.file_name,
    mime: plan.mime,
    width: plan.width,
    height: plan.height,
    size_bytes: plan.size_bytes,
  };
}

function expectAppError(fn, status) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AppError, 'une AppError était attendue');
  assert.equal(caught.status, status);
  return caught;
}

function zipWithManifest(manifest, images, extraEntries = {}) {
  const entries = { ...extraEntries };
  for (const plan of manifest.plans) {
    entries[plan.image] = images.get(plan.id);
  }
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  return zipSync(entries);
}

afterEach(() => {
  clearDatabase();
});

after(() => {
  clearDatabase();
  assert.deepEqual(listPlanFiles(), INITIAL_PLAN_FILES);
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe('survey export/import', () => {
  it('fait un aller-retour avec les mêmes ids, compteurs et valeurs', () => {
    const fixture = createFixture();
    const before = readPlanState(fixture.planId);
    const beforeRules = readBssidRules();
    const zip = buildSurveyExportZip([fixture.surveyId]);

    clearDatabase();
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM plans').get().count, 0);

    const { manifest, images } = parseSurveyExportZip(zip);
    const result = executeSurveyImport({ manifest, images }, {});
    const after = readPlanState(fixture.planId);

    assert.equal(result.plansCreated, 1);
    assert.equal(result.plansMerged, 0);
    assert.deepEqual(result.importedSurveys, [{ id: fixture.surveyId, name: 'Campagne export' }]);
    assert.deepEqual(result.skippedSurveys, []);
    assert.equal(result.scanPoints, 3);
    assert.equal(result.scans, 2);
    assert.equal(result.observations, 4);
    assert.equal(result.bssidRulesAdded, 2);

    assert.deepEqual(idsOfPlanState(after), idsOfPlanState(before));
    assert.deepEqual(after.counts, before.counts);
    assert.deepEqual(comparablePlanFields(after.plan), comparablePlanFields(before.plan));
    assert.deepEqual(
      after.scanPoints.map(({ id, x, y, note, is_enabled }) => ({ id, x, y, note, is_enabled })),
      before.scanPoints.map(({ id, x, y, note, is_enabled }) => ({ id, x, y, note, is_enabled }))
    );
    assert.deepEqual(after.scans.map((row) => row.id), before.scans.map((row) => row.id));
    assert.deepEqual(after.observations.map((row) => row.rssi), before.observations.map((row) => row.rssi));
    assert.deepEqual(after.observations, before.observations);
    assert.deepEqual(after.speedTests, before.speedTests);
    assert.deepEqual(JSON.parse(after.polygons[0].vertices), fixture.vertices);
    assert.deepEqual(readBssidRules(), beforeRules);

    assert.notEqual(after.plan.stored_file, before.plan.stored_file);
    assert.notEqual(after.plan.stored_file, fixture.storedFile);
    assert.ok(existsSync(path.join(PLANS_DIRECTORY, after.plan.stored_file)));
    assert.equal(after.plan.image_url, `/uploads/plans/${after.plan.stored_file}`);
  });

  it('refuse un réimport sans résolution avec RESOLUTION_REQUIRED', () => {
    const fixture = createFixture();
    const zip = buildSurveyExportZip([fixture.surveyId]);
    clearDatabase();
    const { manifest, images } = parseSurveyExportZip(zip);
    executeSurveyImport({ manifest, images }, {});

    const before = databaseFingerprint();
    const error = expectAppError(
      () => executeSurveyImport({ manifest, images }, {}),
      409
    );

    assert.equal(error.code, 'RESOLUTION_REQUIRED');
    assert.deepEqual(error.details, {
      code: 'RESOLUTION_REQUIRED',
      planIds: [fixture.planId],
    });
    assert.equal(databaseFingerprint(), before);
  });

  it('fusionne sans ajouter de lignes ni remplacer l’image', () => {
    const fixture = createFixture();
    const zip = buildSurveyExportZip([fixture.surveyId]);
    clearDatabase();
    const { manifest, images } = parseSurveyExportZip(zip);
    executeSurveyImport({ manifest, images }, {});

    const before = readPlanState(fixture.planId);
    const imageBefore = readFileSync(path.join(PLANS_DIRECTORY, before.plan.stored_file));
    const result = executeSurveyImport({ manifest, images }, {
      [fixture.planId]: 'merge',
    });
    const after = readPlanState(fixture.planId);

    assert.deepEqual(result.importedSurveys, []);
    assert.equal(result.skippedSurveys.length, 1);
    assert.equal(result.skippedSurveys[0].id, fixture.surveyId);
    assert.equal(result.skippedSurveys[0].reason, 'already_exists');
    assert.equal(result.plansCreated, 0);
    assert.equal(result.plansMerged, 1);
    assert.equal(result.scanPoints, 0);
    assert.equal(result.scans, 0);
    assert.equal(result.observations, 0);
    assert.deepEqual(after, before);
    assert.deepEqual(
      readFileSync(path.join(PLANS_DIRECTORY, after.plan.stored_file)),
      imageBefore
    );
  });

  it('duplique avec de nouveaux ids et le suffixe (copie)', () => {
    const fixture = createFixture();
    const zip = buildSurveyExportZip([fixture.surveyId]);
    clearDatabase();
    const { manifest, images } = parseSurveyExportZip(zip);
    executeSurveyImport({ manifest, images }, {});

    const original = readPlanState(fixture.planId);
    const result = executeSurveyImport({ manifest, images }, {
      [fixture.planId]: 'duplicate',
    });
    const copyPlan = getDb()
      .prepare('SELECT * FROM plans WHERE name = ?')
      .get(`${original.plan.name} (copie)`);

    assert.ok(copyPlan);
    assert.notEqual(copyPlan.id, fixture.planId);
    assert.equal(result.plansCreated, 1);
    assert.equal(result.importedSurveys.length, 1);

    const copy = readPlanState(copyPlan.id);
    const originalIds = idsOfPlanState(original);
    for (const id of idsOfPlanState(copy)) {
      assert.ok(!originalIds.has(id), `id dupliqué : ${id}`);
    }
    assert.deepEqual(copy.counts, original.counts);
    assert.equal(result.scanPoints, original.counts.scanPoints);
    assert.equal(result.scans, original.counts.scans);
    assert.equal(result.observations, original.counts.observations);
    assert.equal(result.importedSurveys[0].id, copy.surveys[0].id);
  });

  it('rejette les ZIP invalides sans modifier la base', () => {
    const fixture = createFixture();
    const zip = buildSurveyExportZip([fixture.surveyId]);
    const { manifest, images } = parseSurveyExportZip(zip);

    const checkUnchanged = () => {
      assert.equal(databaseFingerprint(), fingerprintBefore);
      assert.deepEqual(listPlanFiles(), filesBefore);
    };

    let fingerprintBefore = databaseFingerprint();
    let filesBefore = listPlanFiles();
    const traversal = zipWithManifest(manifest, images, {
      '../x': new Uint8Array([1, 2, 3]),
    });
    expectAppError(() => parseSurveyExportZip(traversal), 400);
    checkUnchanged();

    const badVersion = structuredClone(manifest);
    badVersion.version = 99;
    fingerprintBefore = databaseFingerprint();
    filesBefore = listPlanFiles();
    expectAppError(
      () => parseSurveyExportZip(zipWithManifest(badVersion, images)),
      422
    );
    checkUnchanged();

    const badCoordinate = structuredClone(manifest);
    badCoordinate.plans[0].access_points[0].x = 2;
    fingerprintBefore = databaseFingerprint();
    filesBefore = listPlanFiles();
    expectAppError(
      () => parseSurveyExportZip(zipWithManifest(badCoordinate, images)),
      422
    );
    checkUnchanged();
  });

  it('retourne 404 pour un id inconnu et 400 sans id', () => {
    expectAppError(() => buildSurveyExportZip(['inconnu']), 404);
    expectAppError(() => buildSurveyExportZip([]), 400);
  });
});
