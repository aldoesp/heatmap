import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { memoryCache } from '../src/cache/memoryCache.js';
import { buildCacheKey, heatmapFilterSegment, readCached } from '../src/cache/readCache.js';

const directory = mkdtempSync(join(tmpdir(), 'heatmap-cache-'));
process.env.DB_PATH = join(directory, 'test.db');
const configuredMode = process.env.BACKEND_CACHE_ENABLED;
const cacheEnabled = configuredMode === undefined || configuredMode === 'true';

const { getDb, closeDb } = await import('../src/database/db.js');
const { listAllSeenBssids } = await import('../src/repositories/bssidRules.repository.js');
const { listStrongestObservationsBySurvey } = await import('../src/repositories/analysis.repository.js');
const {
  getHistoryByPlan, getHistoryBySurvey, heatmapByPlan, heatmapBySurvey,
  listNetworksByPlan, listNetworksBySurvey, speedByPlan, speedBySurvey,
} = await import('../src/repositories/scans.repository.js');

const plan = 'p:1', otherPlan = 'p%3A1';
const survey = 's:1', otherSurvey = 's:10';
const bssid = index => `02:00:00:00:00:${index.toString(16).padStart(2, '0')}`;
const enabled = () => { process.env.BACKEND_CACHE_ENABLED = 'true'; };

before(() => {
  const db = getDb();
  const insertPlan = db.prepare(`INSERT INTO plans
    (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes)
    VALUES (?, ?, 'plan.png', 'plan.png', '/plan.png', 'image/png', 128, 128, 1024)`);
  const insertSurvey = db.prepare('INSERT INTO surveys (id, plan_id, name) VALUES (?, ?, ?)');
  const insertPoint = db.prepare('INSERT INTO scan_points (id, plan_id, survey_id, x, y) VALUES (?, ?, ?, .25, .75)');
  const insertScan = db.prepare("INSERT INTO scans (id, scan_point_id, plan_id, mode, scanned_at) VALUES (?, ?, ?, 'test', '2025-01-01')");
  const insertObservation = db.prepare(`INSERT INTO observations
    (scan_id, bssid, ssid, band, frequency_mhz, channel, rssi, quality, level, security, standard, current)
    VALUES (?, ?, ?, ?, ?, ?, ?, 80, 'good', 'WPA2', 'ax', ?)`);
  const insertSpeed = db.prepare('INSERT INTO speed_tests (scan_id, tcp_down_bps, duration_s) VALUES (?, ?, 5)');
  db.transaction(() => {
    for (const id of [plan, otherPlan]) insertPlan.run(id, id);
    for (const [surveyId, planId, offset] of [[survey, plan, 0], [otherSurvey, plan, 5], ['s%3A1', otherPlan, 10]]) {
      insertSurvey.run(surveyId, planId, surveyId);
      for (let point = 0; point < 30; point++) {
        const id = `${surveyId}:${point}`;
        insertPoint.run(id, planId, surveyId);
        insertScan.run(id, id, planId);
        insertSpeed.run(id, 100 + offset);
        for (let radio = 0; radio < 15; radio++) {
          const lowBand = radio % 2 === 0;
          insertObservation.run(id, bssid(radio), lowBand ? 'Lab' : 'lab', lowBand ? '2.4GHz' : '5GHz',
            lowBand ? 2412 : 5180, lowBand ? 1 : 36, -40 - offset - radio, Number(radio === 0));
        }
      }
    }
    db.prepare("INSERT INTO bssid_rules (id, bssid, name, blacklisted) VALUES ('rule', ?, 'Alias', 0), ('blocked', ?, '', 1)")
      .run(bssid(0), bssid(14));
  })();
});

beforeEach(() => {
  if (configuredMode === undefined) delete process.env.BACKEND_CACHE_ENABLED;
  else process.env.BACKEND_CACHE_ENABLED = configuredMode;
  memoryCache.clear();
  memoryCache.resetStats();
});

after(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

const reads = [
  ['seen', listAllSeenBssids],
  ['historyPlan', () => getHistoryByPlan(plan)],
  ['historySurvey', () => getHistoryBySurvey(survey)],
  ['heatmapPlan', () => heatmapByPlan(plan)],
  ['heatmapSurvey', () => heatmapBySurvey(survey)],
  ['networksPlan', () => listNetworksByPlan(plan)],
  ['networksSurvey', () => listNetworksBySurvey(survey)],
  ['speedPlan', () => speedByPlan(plan)],
  ['speedSurvey', () => speedBySurvey(survey)],
  ['analysisSurvey', () => listStrongestObservationsBySurvey(survey)],
];

test('cache actif par défaut et désactivable explicitement', () => {
  for (const value of ['false', '1']) {
    process.env.BACKEND_CACHE_ENABLED = value;
    for (const [, read] of reads) {
      const rows = read();
      assert.ok(rows.length > 0);
      assert.notEqual(rows, read());
    }
  }
  assert.equal(memoryCache.stats().entries, 0);
  assert.equal(memoryCache.stats().misses, 0);
  assert.equal(memoryCache.stats().estimatedSizeBytes, 0);
  delete process.env.BACKEND_CACHE_ENABLED;
  const rows = heatmapByPlan(plan);
  assert.equal(heatmapByPlan(plan), rows);
  assert.equal(memoryCache.stats().hits, 1);
});

test('chaque lecture ciblée conserve son résultat au premier miss puis le réutilise', () => {
  const expected = getDb().transaction(() => reads.map(([, read]) => read()))();
  reads.forEach(([name, read], index) => {
    const first = read();
    assert.deepEqual(first, expected[index], name);
    if (cacheEnabled) assert.equal(read(), first, name);
    else assert.notEqual(read(), first, name);
  });
  assert.equal(memoryCache.stats().misses, cacheEnabled ? reads.length : 0);
  assert.equal(memoryCache.stats().hits, cacheEnabled ? reads.length : 0);
  assert.equal(memoryCache.stats().entries, cacheEnabled ? reads.length : 0);
  assert.ok(heatmapBySurvey(survey).every(row => row.bssid !== bssid(14)));
  assert.ok(listStrongestObservationsBySurvey(survey).some(row => row.bssid_name === 'Alias'));
});

test('isole les plans, les surveys et les filtres réellement appliqués', () => {
  assert.notDeepEqual(heatmapByPlan(plan), heatmapByPlan(otherPlan));
  assert.notDeepEqual(heatmapBySurvey(survey), heatmapBySurvey(otherSurvey));
  assert.notDeepEqual(getHistoryBySurvey(survey), getHistoryBySurvey('s%3A1'));

  const variants = [{}, { ssid: 'Lab' }, { ssid: 'lab' }, { bssid: bssid(10) },
    { band: '5GHz' }, { connected: true }, { band: '5GHz', connected: true }];
  const results = variants.map(filters => heatmapBySurvey(survey, filters));
  assert.equal(new Set(results).size, variants.length);
  for (const [index, filters] of variants.entries()) {
    assert.deepEqual(results[index], getDb().transaction(() => heatmapBySurvey(survey, filters))());
    const again = heatmapBySurvey(survey, filters);
    if (cacheEnabled) assert.equal(results[index], again);
    else assert.deepEqual(results[index], again);
  }
  assert.equal(results.at(-1).length, 0);
});

test('clés délimitées et filtres normalisés uniquement selon leur sémantique SQL', () => {
  const filters = { band: '2.4GHz', bssid: bssid(10), ssid: 'Lab', connected: true };
  const reordered = { connected: 1, ssid: 'Lab', bssid: bssid(10).toUpperCase(), band: '2.4GHz' };
  assert.equal(heatmapFilterSegment(filters), heatmapFilterSegment(reordered));
  assert.equal(heatmapFilterSegment({ ssid: '', connected: false, minRssi: -40 }), 'all');
  assert.notEqual(buildCacheKey('heatmap', 'plan', plan, 'all'), buildCacheKey('heatmap', 'plan', otherPlan, 'all'));
  assert.notEqual(buildCacheKey('a:b', 'c'), buildCacheKey('a', 'b:c'));
  const original = heatmapBySurvey(survey, filters);
  const equivalent = heatmapBySurvey(survey, reordered);
  assert.deepEqual(original, equivalent);
  if (cacheEnabled) assert.equal(original, equivalent);
  assert.equal(memoryCache.stats().hits, cacheEnabled ? 1 : 0);
  assert.throws(() => heatmapBySurvey(survey, { bssid: 42 }), TypeError);
  assert.equal(memoryCache.stats().entries, cacheEnabled ? 1 : 0);
});

test('les lectures dans une transaction voient les écritures et ne stockent rien', () => {
  const before = heatmapBySurvey(survey);
  const stats = memoryCache.stats();
  const db = getDb();
  const rollback = new Error('rollback');
  assert.throws(db.transaction(() => {
    db.prepare('UPDATE scan_points SET is_enabled = 0 WHERE survey_id = ?').run(survey);
    assert.deepEqual(heatmapBySurvey(survey), []);
    assert.equal(getHistoryBySurvey(survey)[0].is_enabled, 0);
    assert.deepEqual(memoryCache.stats(), stats);
    throw rollback;
  }), error => error === rollback);
  const after = heatmapBySurvey(survey);
  assert.deepEqual(after, before);
  if (cacheEnabled) assert.equal(after, before);
});

test('closeDb vide le cache et la lecture après réouverture est un miss', () => {
  const before = heatmapBySurvey(survey);
  closeDb();
  assert.equal(memoryCache.stats().entries, 0);
  assert.equal(memoryCache.stats().estimatedSizeBytes, 0);
  const after = heatmapBySurvey(survey);
  assert.deepEqual(after, before);
  assert.notEqual(after, before);
  assert.equal(memoryCache.stats().misses, cacheEnabled ? 2 : 0);
});

test('une lecture du repository sous pression respecte les limites du moteur partagé', () => {
  const nearLimit = Buffer.alloc(8 * 1024 ** 2 - 1024);
  for (let index = 0; index < 8; index++) assert.equal(memoryCache.set(`pressure:${index}`, nearLimit), true);
  const rows = heatmapByPlan(plan);
  const stats = memoryCache.stats();
  assert.equal(stats.evictions > 0, cacheEnabled);
  assert.ok(stats.estimatedSizeBytes <= stats.maxSizeBytes);
  if (cacheEnabled) assert.equal(heatmapByPlan(plan), rows);
  const oversized = Buffer.alloc(8 * 1024 ** 2);
  assert.equal(readCached(getDb(), () => ['pressure', 'oversized'], () => oversized), oversized);
  assert.equal(memoryCache.has('pressure:oversized'), false);
  assert.equal(memoryCache.stats().rejectedEntries, cacheEnabled ? 1 : 0);
});

if (process.env.BENCH_PHASE4B === '1') test('mesures ciblées à froid et à chaud', () => {
  const iterations = 25;
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  function measure(read) {
    const start = performance.now();
    read();
    return performance.now() - start;
  }
  const results = {};
  for (const [name, read] of reads.filter(([name]) => ['seen', 'heatmapPlan', 'analysisSurvey'].includes(name))) {
    const off = [], misses = [], hits = [];
    for (let index = 0; index < iterations + 5; index++) {
      process.env.BACKEND_CACHE_ENABLED = 'false';
      const uncached = measure(read);
      enabled();
      memoryCache.clear();
      const miss = measure(read);
      const hit = measure(read);
      if (index >= 5) {
        off.push(uncached);
        misses.push(miss);
        hits.push(hit);
      }
    }
    results[name] = { disabledMs: median(off), missMs: median(misses), hitMs: median(hits) };
  }
  console.log(JSON.stringify({ iterations, results }));
});
