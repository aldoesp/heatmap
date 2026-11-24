import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCache } from '../src/cache/memoryCache.js';
import { buildCacheKey } from '../src/cache/readCache.js';
import { invalidateObservationData } from '../src/cache/invalidation.js';

const temp = mkdtempSync(join(tmpdir(), 'heatmap-invalidation-'));
process.env.DB_PATH = join(temp, 'test.db');
const cacheEnabled = process.env.BACKEND_CACHE_ENABLED === undefined || process.env.BACKEND_CACHE_ENABLED === 'true';

const { getDb, closeDb } = await import('../src/database/db.js');
const { insertPlan, deletePlan, renamePlan } = await import('../src/repositories/plans.repository.js');
const { deleteSurvey, renameSurvey } = await import('../src/repositories/surveys.repository.js');
const { insertScanPoint, updateScanPoint, deleteScanPoint } = await import('../src/repositories/scanPoints.repository.js');
const { insertBssidRule, updateBssidRule, deleteBssidRule, listAllSeenBssids } = await import('../src/repositories/bssidRules.repository.js');
const { listStrongestObservationsBySurvey } = await import('../src/repositories/analysis.repository.js');
const {
  insertScanWithObservations, insertSpeedTest, getHistoryByPlan, getHistoryBySurvey,
  heatmapByPlan, heatmapBySurvey, listNetworksByPlan, listNetworksBySurvey, speedByPlan, speedBySurvey,
} = await import('../src/repositories/scans.repository.js');
const { importCsvSurvey } = await import('../src/services/csvImport.service.js');

const plan = 'plan:1', otherPlan = 'plan:10';
const survey = 'survey:1', sibling = 'survey:10', otherSurvey = 'survey%3A1';
const radio = '02:00:00:00:00:01';
const newRadio = '02:00:00:00:00:02';
const csvRadio = '02:00:00:00:00:03';

function recordScan(scan_point_id, options = {}, plan_id) {
  const entry = {
    bssid: radio, ssid: 'Lab', band: '5GHz', frequency_mhz: 5180, channel: 36, rssi: -70,
    quality: 60, level: 'fair', security: 'WPA2', standard: 'ax', current: true,
    bandwidth_mhz: null, center_frequency_mhz: null, center_channel: null, timestamp_us: null,
    ...options,
  };
  return insertScanWithObservations({
    scan_point_id,
    plan_id: plan_id ?? getDb().prepare('SELECT plan_id FROM scan_points WHERE id = ?').get(scan_point_id).plan_id,
    mode: 'test',
    scanned_at: '2026-01-01T08:00:00Z', rejected_count: 0, entries: [entry],
  });
}

let point;
let initialScan;
beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM plans; DELETE FROM bssid_rules');
  memoryCache.clear();
  memoryCache.resetStats();
  for (const id of [plan, otherPlan]) {
    insertPlan({ id, name: id, file_name: 'fixture.png', stored_file: 'fixture.png',
      image_url: '/fixture.png', mime: 'image/png', width: 8, height: 8, size_bytes: 1 });
  }
  const addSurvey = db.prepare('INSERT INTO surveys (id, plan_id, name) VALUES (?, ?, ?)');
  for (const [id, planId] of [[survey, plan], [sibling, plan], [otherSurvey, otherPlan]]) {
    addSurvey.run(id, planId, id);
    const row = insertScanPoint({ plan_id: planId, survey_id: id, x: .25, y: .75 });
    const scanId = recordScan(row.id, { ssid: id === survey ? 'Lab' : id });
    if (id === survey) {
      point = row;
      initialScan = scanId;
    }
  }
});

after(() => {
  closeDb();
  rmSync(temp, { recursive: true, force: true });
});

function warm(read) {
  const first = read();
  const next = read();
  if (cacheEnabled) assert.equal(next, first);
  else assert.deepEqual(next, first);
  return first;
}

function refreshed(read, previous) {
  const next = warm(read);
  assert.notEqual(next, previous);
  assert.deepEqual(next, getDb().transaction(read)());
  return next;
}

function unchanged(read, previous) {
  const next = read();
  assert.deepEqual(next, previous);
  if (cacheEnabled) assert.equal(next, previous);
}

const historyPlan = () => getHistoryByPlan(plan);
const history = () => getHistoryBySurvey(survey);
const heatmap = () => heatmapBySurvey(survey);
const analysis = () => listStrongestObservationsBySurvey(survey);
const speed = () => speedBySurvey(survey);

test('nouveau scan et variantes filtrées, sans évincer les autres périmètres', () => {
  const reads = [
    heatmap, () => heatmapByPlan(plan), () => heatmapBySurvey(survey, { ssid: 'Lab' }),
    () => heatmapByPlan(plan, { bssid: radio, connected: true }),
    () => heatmapBySurvey(survey, { band: '5GHz' }),
  ];
  const before = reads.map(warm);
  const oldHistory = warm(history);
  const oldNetworks = warm(() => listNetworksBySurvey(survey));
  const oldAnalysis = warm(analysis);
  const seen = warm(listAllSeenBssids);
  const siblings = () => heatmapBySurvey(sibling);
  const unrelated = () => heatmapByPlan(otherPlan);
  const encoded = () => heatmapBySurvey(otherSurvey);
  const independent = [siblings, unrelated, encoded].map(warm);

  recordScan(point.id, { rssi: -42 });
  recordScan(point.id, { rssi: -51, bssid: newRadio, ssid: 'New' });
  before.forEach((rows, index) => {
    const updated = refreshed(reads[index], rows).find(row => row.scan_point_id === point.id && row.bssid === radio);
    assert.equal(updated.rssi, -42);
  });
  assert.equal(refreshed(history, oldHistory)[0].scans.length, 3);
  assert.ok(refreshed(() => listNetworksBySurvey(survey), oldNetworks).some(row => row.ssid === 'New'));
  assert.equal(refreshed(analysis, oldAnalysis).find(row => row.bssid === radio).rssi, -42);
  assert.ok(refreshed(listAllSeenBssids, seen).some(row => row.bssid === newRadio));
  [siblings, unrelated, encoded].forEach((read, index) => unchanged(read, independent[index]));
});

test('nouveau débit met à jour les deux périmètres sans évincer le RSSI', () => {
  const reads = [history, historyPlan, speed, () => speedByPlan(plan)];
  const before = reads.map(warm);
  const rssi = warm(heatmap);
  insertSpeedTest({ scan_id: initialScan, tcp_down_bps: 123456, tcp_up_bps: 56, duration_s: 1 });
  for (const index of [0, 1]) {
    const row = refreshed(reads[index], before[index]).find(row => row.id === point.id);
    assert.equal(row.scans[0].tcp_down_bps, 123456);
  }
  for (const index of [2, 3]) assert.equal(refreshed(reads[index], before[index])[0].speed_bps, 123456);
  unchanged(heatmap, rssi);
});

test('création, note, désactivation, réactivation et suppression d’un point', () => {
  const oldHistory = warm(history);
  const initialRssi = warm(heatmap);
  const added = insertScanPoint({ plan_id: plan, survey_id: survey, x: .61, y: .91 });
  assert.ok(refreshed(history, oldHistory).some(row => row.id === added.id && row.x === .61 && row.y === .91));
  unchanged(heatmap, initialRssi);
  const withAdded = warm(history);
  const analyzed = warm(analysis);
  updateScanPoint(point.id, { note: 'Couloir' });
  assert.equal(refreshed(history, withAdded).find(row => row.id === point.id).note, 'Couloir');
  assert.equal(refreshed(analysis, analyzed)[0].note, 'Couloir');
  unchanged(heatmap, initialRssi);

  insertSpeedTest({ scan_id: initialScan, tcp_down_bps: 1000, tcp_up_bps: 0, duration_s: 1 });
  const fast = warm(speed);
  const enabledHistory = warm(history);
  updateScanPoint(point.id, { is_enabled: false });
  assert.deepEqual(refreshed(heatmap, initialRssi), []);
  assert.deepEqual(refreshed(speed, fast), []);
  assert.equal(refreshed(history, enabledHistory).find(row => row.id === point.id).is_enabled, 0);
  const disabled = warm(heatmap);
  updateScanPoint(point.id, { is_enabled: true });
  assert.equal(refreshed(heatmap, disabled)[0].rssi, -70);

  recordScan(point.id, { bssid: newRadio });
  const rssi = warm(heatmap);
  const seen = warm(listAllSeenBssids);
  assert.equal(deleteScanPoint(point.id), true);
  assert.deepEqual(refreshed(heatmap, rssi), []);
  assert.deepEqual(warm(history).map(row => row.id), [added.id]);
  assert.ok(!refreshed(listAllSeenBssids, seen).some(row => row.bssid === newRadio));
});

test('suppressions en cascade de survey et plan, avec isolation du voisin', () => {
  recordScan(point.id, { bssid: newRadio });
  const planBefore = warm(historyPlan);
  const surveyBefore = warm(heatmap);
  const siblingRead = () => heatmapBySurvey(sibling);
  const siblingBefore = warm(siblingRead);
  const otherRead = () => heatmapByPlan(otherPlan);
  const otherBefore = warm(otherRead);
  const seen = warm(listAllSeenBssids);

  renamePlan(plan, 'Renommé');
  renameSurvey(survey, 'Renommé');
  unchanged(historyPlan, planBefore);
  unchanged(heatmap, surveyBefore);
  assert.equal(deleteSurvey(survey), true);
  assert.deepEqual(refreshed(heatmap, surveyBefore), []);
  assert.deepEqual(refreshed(historyPlan, planBefore).map(row => row.survey_id), [sibling]);
  assert.ok(!refreshed(listAllSeenBssids, seen).some(row => row.bssid === newRadio));
  unchanged(siblingRead, siblingBefore);
  const remaining = warm(historyPlan);
  assert.equal(deletePlan(plan), true);
  assert.deepEqual(refreshed(historyPlan, remaining), []);
  assert.deepEqual(refreshed(siblingRead, siblingBefore), []);
  unchanged(otherRead, otherBefore);
});

test('une cascade couvre aussi un scan hérité dont le plan diffère de celui du point', () => {
  const networks = () => listNetworksByPlan(otherPlan);
  const originalNetworks = warm(networks);
  const originalRssi = warm(heatmap);
  recordScan(point.id, { bssid: newRadio, rssi: -40 }, otherPlan);
  assert.ok(refreshed(networks, originalNetworks).some(row => row.bssid === newRadio));
  const both = refreshed(heatmap, originalRssi);
  assert.ok(both.some(row => row.bssid === newRadio));
  assert.equal(deletePlan(otherPlan), true);
  const remaining = refreshed(heatmap, both);
  assert.deepEqual(remaining, originalRssi);
});

test('alias, blacklist, réactivation et suppression d’une règle BSSID', () => {
  const before = warm(heatmap);
  const seen = warm(listAllSeenBssids);
  const independentPlan = () => listNetworksByPlan(otherPlan);
  const other = warm(independentPlan);
  const speedBefore = warm(speed);
  const rule = insertBssidRule({ bssid: radio, name: 'Alias', blacklisted: false });
  assert.equal(refreshed(heatmap, before)[0].bssid_name, 'Alias');
  assert.equal(refreshed(independentPlan, other)[0].bssid_name, 'Alias');
  assert.equal(refreshed(listAllSeenBssids, seen)[0].rule_id, rule.id);

  const alias = warm(analysis);
  updateBssidRule(rule.id, { name: 'Renommé', blacklisted: false });
  assert.equal(refreshed(analysis, alias)[0].bssid_name, 'Renommé');
  const allowed = warm(history);
  const rssi = warm(heatmap);
  updateBssidRule(rule.id, { name: 'Renommé', blacklisted: true });
  assert.deepEqual(refreshed(heatmap, rssi), []);
  assert.equal(refreshed(history, allowed)[0].scans[0].network_count, 0);
  const excluded = warm(heatmap);
  updateBssidRule(rule.id, { name: 'Réactivé', blacklisted: false });
  assert.equal(refreshed(heatmap, excluded)[0].bssid_name, 'Réactivé');

  const renamed = warm(heatmap);
  updateBssidRule(rule.id, { name: 'Réactivé', blacklisted: true });
  assert.deepEqual(refreshed(heatmap, renamed), []);
  const blacklisted = warm(heatmap);
  assert.equal(deleteBssidRule(rule.id), true);
  assert.equal(refreshed(heatmap, blacklisted)[0].bssid_name, radio);
  unchanged(speed, speedBefore);
});

const header = 'point_id,scan_id,x,y,enabled,scanned_at,mode,bssid,ssid,frequency_mhz,rssi_dbm,tcp_down_mbps';
const csvRow = (id, mode = 'test', bssid = csvRadio) =>
  `${id},${id},0.2,0.4,yes,2026-01-01,${mode},${bssid},CSV,5180,-50,2`;

test('import CSV met à jour les résultats et les BSSID vus', () => {
  const seen = warm(listAllSeenBssids);
  const { planId, surveyId } = importCsvSurvey([header, csvRow('one')].join('\n'));
  assert.ok(refreshed(listAllSeenBssids, seen).some(row => row.bssid === csvRadio));
  assert.equal(warm(() => heatmapByPlan(planId))[0].rssi, -50);
  assert.equal(warm(() => speedBySurvey(surveyId))[0].speed_bps, 2_000_000);
});

test('un CSV interrompu conserve les écritures validées et invalide les lectures concernées', () => {
  const seen = warm(listAllSeenBssids);
  assert.throws(
    () => importCsvSurvey([header, csvRow('success'), csvRow('failure', 'invalid', newRadio)].join('\n'),
      { planName: 'Partiel' }),
    { code: 'SQLITE_CONSTRAINT_CHECK' },
  );
  const { id } = getDb().prepare("SELECT id FROM plans WHERE name = 'Partiel'").get();
  assert.equal(warm(() => getHistoryByPlan(id)).length, 2);
  assert.deepEqual(warm(() => heatmapByPlan(id)).map(row => row.bssid), [csvRadio]);
  const current = refreshed(listAllSeenBssids, seen);
  assert.ok(current.some(row => row.bssid === csvRadio));
  assert.ok(!current.some(row => row.bssid === newRadio));
});

test('échec SQL et rollback du scan ne modifient ni les données ni les entrées cachées', () => {
  const before = warm(heatmap);
  const historyBefore = warm(history);
  assert.throws(() => recordScan(point.id, { rssi: 1 }), { code: 'SQLITE_CONSTRAINT_CHECK' });
  unchanged(heatmap, before);
  unchanged(history, historyBefore);
});

test('savepoints validés sous transaction externe et rollback interne ou externe', () => {
  const db = getDb();
  const abort = new Error('rollback');
  const before = warm(heatmap);
  db.transaction(() => {
    recordScan(point.id, { rssi: -60 });
    assert.equal(heatmap()[0].rssi, -60);
    assert.throws(db.transaction(() => {
      recordScan(point.id, { rssi: -40 });
      assert.equal(heatmap()[0].rssi, -40);
      throw abort;
    }), error => error === abort);
    assert.equal(heatmap()[0].rssi, -60);
    assert.equal(memoryCache.stats().entries, 0);
  })();
  const committed = refreshed(heatmap, before);
  assert.equal(committed[0].rssi, -60);
  assert.throws(db.transaction(() => {
    recordScan(point.id, { rssi: -30 });
    assert.equal(heatmap()[0].rssi, -30);
    assert.equal(memoryCache.stats().entries, 0);
    throw abort;
  }), error => error === abort);
  assert.equal(refreshed(heatmap, committed)[0].rssi, -60);
});

test('une résolution de périmètre en échec vide le cache sans annuler l’écriture validée', (t) => {
  const before = warm(heatmap);
  warm(() => heatmapByPlan(otherPlan));
  const db = getDb();
  const prepare = db.prepare;
  const stub = t.mock.method(db, 'prepare', function (sql) {
    if (sql === 'SELECT plan_id, survey_id FROM scan_points WHERE id = ?') throw new Error('Scope indisponible');
    return prepare.call(this, sql);
  });
  recordScan(point.id, { rssi: -35 });
  stub.mock.restore();
  assert.equal(memoryCache.stats().entries, 0);
  assert.equal(refreshed(heatmap, before)[0].rssi, -35);
});

if (process.env.BENCH_PHASE4C === '1') test('mesure ciblée de l’invalidation', () => {
  const runs = [];
  const keys = Array.from({ length: 300 }, (_, index) =>
    index < 10 ? buildCacheKey('heatmap', 'plan', plan, String(index)) : `independent:${index}`);
  for (let index = 0; index < 110; index++) {
    for (const key of keys) memoryCache.set(key, []);
    const start = performance.now();
    invalidateObservationData([{ plan_id: plan, survey_id: survey }]);
    if (index >= 10) runs.push(performance.now() - start);
    assert.equal(memoryCache.stats().entries, 290);
  }
  runs.sort((a, b) => a - b);
  console.log(JSON.stringify({ iterations: runs.length, entries: keys.length, medianMs: runs[50], p95Ms: runs[94] }));
});
