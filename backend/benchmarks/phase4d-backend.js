import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { seedDatabase, summarize } from './backend-fixture.js';

const script = fileURLToPath(import.meta.url);
const backend = path.resolve(path.dirname(script), '..');
const presets = {
  small: { plans: 2, pointsPerPlan: 45, scansPerPoint: 1, observationsPerScan: 15, bssids: 200 },
  reference: { plans: 20, pointsPerPlan: 30, scansPerPoint: 1, observationsPerScan: 15, bssids: 200 },
  high: { plans: 20, pointsPerPlan: 100, scansPerPoint: 3, observationsPerScan: 15, bssids: 200 },
};
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([\w]+)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Option invalide : ${arg}`);
  return match.slice(1);
}));
const defaults = { iterations: 30, warmup: 5, journeyRuns: 3, mixedOperations: 60, filterRounds: 3, coldRuns: 3 };
const mode = enabled => { process.env.BACKEND_CACHE_ENABLED = String(enabled); };
const id = (kind, index) => `${kind}-${String(index).padStart(2, '0')}`;

function optionsFor(volume) {
  assert.ok(Object.hasOwn(presets, volume), `Volume inconnu : ${volume}`);
  const options = { ...presets[volume], ...defaults };
  for (const [key, value] of Object.entries(args)) {
    if (['volume', 'worker', 'output'].includes(key)) continue;
    assert.ok(Object.hasOwn(options, key), `Option inconnue : ${key}`);
    options[key] = Number(value);
    const minimum = key === 'warmup' ? 0 : ['pointsPerPlan', 'plans', 'bssids'].includes(key) ? 2 : 1;
    assert.ok(Number.isSafeInteger(options[key]) && options[key] >= minimum, key);
  }
  return options;
}

function makePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
    prefix.writeUInt32BE(data.length);
    suffix.writeUInt32BE(crc32(body));
    return Buffer.concat([prefix, body, suffix]);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function runVolume(volume) {
  const options = optionsFor(volume);
  const temporary = mkdtempSync(path.join(tmpdir(), 'heatmap-phase4d-'));
  const dbPath = path.join(temporary, 'bench.db');
  const snapshot = path.join(temporary, 'seed.db');
  const uploadPlans = path.join(temporary, 'uploads', 'plans');
  const load = relative => import(pathToFileURL(path.join(temporary, 'src', relative)).href);
  let server;
  let closeDb;
  const clients = Array.from({ length: 6 }, () => new http.Agent({ keepAlive: true, maxSockets: 1 }));
  const originalLog = console.log;
  try {
    // The copy keeps import/export paths relative to the temporary directory.
    cpSync(path.join(backend, 'src'), path.join(temporary, 'src'), { recursive: true });
    symlinkSync(path.join(backend, 'node_modules'), path.join(temporary, 'node_modules'));
    writeFileSync(path.join(temporary, 'package.json'), '{"type":"module"}');
    mkdirSync(uploadPlans, { recursive: true });
    Object.assign(process.env, { DB_PATH: dbPath, RATE_LIMIT_API: '1000000', SCAN_MODE: 'test', SKIP_GATEWAY_PING: '1' });
    mode(false);
    const database = await load('database/db.js');
    const { getDb } = database;
    closeDb = database.closeDb;
    const { memoryCache, createMemoryCache } = await load('cache/memoryCache.js');
    const scans = await load('repositories/scans.repository.js');
    const points = await load('repositories/scanPoints.repository.js');
    const plans = await load('repositories/plans.repository.js');
    const surveys = await load('repositories/surveys.repository.js');
    const rules = await load('repositories/bssidRules.repository.js');
    const analysis = await load('repositories/analysis.repository.js');
    const { importCsvSurvey } = await load('services/csvImport.service.js');
    const { buildSurveyExportZip } = await load('services/surveyExport.service.js');
    const { parseSurveyExportZip, executeSurveyImport } = await load('services/surveyImport.service.js');
    const planIds = Array.from({ length: options.plans }, (_, index) => id('plan', index));
    const plan = planIds[0], survey = id('survey', 0);
    const db = getDb();
    db.transaction(() => seedDatabase(db, options))();
    const images = new Map();
    for (const { id, width, height } of plans.listPlans()) {
      const size = `${width}x${height}`;
      if (!images.has(size)) images.set(size, makePng(width, height));
      writeFileSync(path.join(uploadPlans, `${id}.png`), images.get(size));
    }
    const counts = Object.fromEntries(['plans', 'surveys', 'scan_points', 'scans', 'observations'].map(name =>
      [name, db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count]));
    counts.bssids = db.prepare('SELECT COUNT(DISTINCT bssid) AS count FROM observations').get().count;
    const sampleObservations = db.prepare("SELECT * FROM observations WHERE scan_id = 'scan-0-0-0' ORDER BY id").all();
    const radios = db.prepare('SELECT bssid FROM bssid_rules ORDER BY bssid LIMIT 4 OFFSET 1').all().map(row => row.bssid);
    const targetRule = db.prepare('SELECT id, bssid FROM bssid_rules WHERE blacklisted = 0 ORDER BY id LIMIT 1').get();
    const zip = buildSurveyExportZip({ surveyIds: [survey] });
    // A speed-free scan is needed even with custom scansPerPoint.
    const speedScan = db.prepare(`SELECT s.id FROM scans s LEFT JOIN speed_tests t ON t.scan_id = s.id
      WHERE t.id IS NULL AND s.scan_point_id = 'point-0-1' ORDER BY s.id LIMIT 1`).get().id;
    closeDb();
    copyFileSync(dbPath, snapshot);
    const restore = enabled => {
      closeDb();
      copyFileSync(snapshot, dbPath);
      mode(enabled);
      getDb();
      memoryCache.resetStats();
    };

    const { default: app } = await load('app.js');
    console.log = () => {};
    server = http.createServer(app);
    server.keepAliveTimeout = 300_000;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    function request(endpoint, client = 0) {
      return new Promise((resolve, reject) => {
        const outgoing = http.get({ hostname: '127.0.0.1', port, path: '/api/v1' + endpoint, agent: clients[client] }, res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${endpoint}`));
            resolve(Buffer.concat(chunks));
          });
        });
        outgoing.on('error', error => reject(new Error(`Échec HTTP ${endpoint}: ${error.message}`, { cause: error })));
        outgoing.setTimeout(30_000, () => outgoing.destroy(new Error('délai dépassé')));
      });
    }
    const routes = {
      seen: ['/bssid-rules/seen', rules.listAllSeenBssids],
      analysis: [`/surveys/${survey}/analysis/history`, () => analysis.listStrongestObservationsBySurvey(survey)],
    };
    for (const [scope, value] of [['Plan', plan], ['Survey', survey]]) {
      const base = scope === 'Plan' ? '/plans/' : '/surveys/';
      for (const [label, suffix, prefix] of [
        ['history', 'history', 'getHistory'], ['heatmap', 'heatmap', 'heatmap'],
        ['networks', 'networks', 'listNetworks'], ['speed', 'heatmap-speed', 'speed'],
      ]) routes[label + scope] = [base + value + '/' + suffix, () => scans[prefix + 'By' + scope](value)];
    }
    await request('/health');

    const caseNames = ['disabled', 'miss', 'hit'];
    async function measureRead(read, name) {
      const output = {};
      let expected;
      for (const kind of caseNames) {
        mode(kind !== 'disabled');
        memoryCache.clear();
        if (kind === 'hit') await read();
        memoryCache.resetStats();
        const times = [];
        for (let index = 0; index < options.iterations + options.warmup; index++) {
          if (kind === 'miss') memoryCache.clear();
          const before = performance.now();
          const value = await read();
          const ms = performance.now() - before;
          if (index >= options.warmup) times.push(ms);
          const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
          expected ??= bytes;
          assert.ok(expected.equals(bytes), `Réponse différente : ${name}/${kind}`);
        }
        const stats = memoryCache.stats();
        const calls = options.iterations + options.warmup;
        assert.equal(stats.hits, kind === 'hit' ? calls : 0, name);
        assert.equal(stats.misses, kind === 'miss' ? calls : 0, name);
        output[kind] = { ...summarize(times), responseBytes: expected.length, cache: stats };
      }
      return output;
    }

    async function measureCold(read, openSeparately) {
      mode(false);
      const query = [], open = [];
      for (let index = 0; index < options.coldRuns; index++) {
        closeDb();
        if (openSeparately) {
          const start = performance.now();
          getDb();
          open.push(performance.now() - start);
        }
        const start = performance.now();
        await read();
        query.push(performance.now() - start);
      }
      return openSeparately ? { open: summarize(open), query: summarize(query) } : summarize(query);
    }

    process.stderr.write(`[${volume}] Lectures\n`);
    const reads = {};
    for (const [name, [route, repo]] of Object.entries(routes)) {
      reads[name] = {
        repository: await measureRead(repo, name),
        http: await measureRead(() => request(route), name),
        repositoryCold: await measureCold(repo, true),
        httpColdIncludingOpen: await measureCold(() => request(route), false),
      };
    }

    const recordScan = index => {
      return scans.insertScanWithObservations({
        scan_point_id: 'point-0-0', plan_id: plan, mode: 'test', rejected_count: 0,
        scanned_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        entries: sampleObservations.map(({ capabilities, ...entry }, radio) => ({
          ...entry, ssid: 'Mutation', rssi: -30 - radio % 15, capabilities: JSON.parse(capabilities),
        })),
      });
    };
    const addSpeed = scanId => scans.insertSpeedTest({ scan_id: scanId, tcp_down_bps: 123_000_000, tcp_up_bps: 30_000_000, duration_s: 2 });
    const updateRule = index => rules.updateBssidRule(targetRule.id, { name: `Alias ${index}`, blacklisted: index % 2 === 0 });
    const csv = [
      'point_id,scan_id,x,y,enabled,scanned_at,mode,bssid,ssid,frequency_mhz,rssi_dbm,tcp_down_mbps',
      ...Array.from({ length: 10 }, (_, point) => sampleObservations.map(({ bssid, frequency_mhz }) =>
        `p${point},s${point},0.${point},.5,yes,2026-01-01,test,${bssid},CSV,${frequency_mhz},-42,10`)).flat(),
    ].join('\n');
    const writeOperations = {
      scan: () => recordScan(0), speed: () => addSpeed(speedScan),
      disablePoint: () => points.updateScanPoint('point-0-0', { is_enabled: false }),
      deletePoint: () => points.deleteScanPoint('point-0-0'), deleteSurvey: () => surveys.deleteSurvey(survey),
      deletePlan: () => plans.deletePlan(plan), rule: () => updateRule(0),
      csv: () => importCsvSurvey(csv),
      zip: () => executeSurveyImport(parseSurveyExportZip(zip), { [plan]: 'duplicate' }),
    };

    function equivalentReads(readers) {
      for (const read of readers) assert.deepEqual(read(), getDb().transaction(read)());
    }

    process.stderr.write(`[${volume}] Écritures\n`);
    const writes = {};
    for (const [name, operation] of Object.entries(writeOperations)) {
      writes[name] = {};
      const readers = Object.values(routes).map(([, read]) => read);
      const samples = { disabled: [], enabled: [] };
      const evicted = { disabled: [], enabled: [] };
      for (let index = 0; index < options.iterations + options.warmup; index++) {
        for (const enabled of index % 2 ? [true, false] : [false, true]) {
          restore(enabled);
          for (const read of readers) read();
          const initial = memoryCache.stats().invalidations;
          const start = performance.now();
          const result = operation();
          const duration = performance.now() - start;
          assert.ok(result);
          const key = enabled ? 'enabled' : 'disabled';
          if (index >= options.warmup) {
            samples[key].push(duration);
            evicted[key].push(memoryCache.stats().invalidations - initial);
          }
          if (index === options.iterations + options.warmup - 1) equivalentReads(readers);
          if (name === 'zip') {
            const importedPlan = getDb().prepare('SELECT stored_file FROM plans WHERE id NOT LIKE ?').get('plan-%');
            rmSync(path.join(uploadPlans, importedPlan.stored_file));
          }
        }
      }
      for (const key of ['disabled', 'enabled']) {
        writes[name][key] = { ...summarize(samples[key]), invalidatedEntries: summarize(evicted[key]) };
      }
    }

    // Les écritures synchrones peuvent dépasser le délai des connexions HTTP ouvertes pendant les lectures.
    for (const client of clients) client.destroy();
    process.stderr.write(`[${volume}] Parcours\n`);
    const historyPath = `/plans/${plan}/history`;
    const heatmapPath = `/plans/${plan}/heatmap`;
    const analysisPath = routes.analysis[0];
    const sequence = async paths => { for (const endpoint of paths) await request(endpoint); };
    const journeys = {
      library: async () => {
        await request('/plans');
        for (const item of planIds) await sequence(['surveys', 'history', 'heatmap', 'ap-mappings'].map(suffix => `/plans/${item}/${suffix}`));
      },
      planNavigation: () => sequence([...planIds.slice(0, 4), plan].flatMap(item =>
        ['history', 'heatmap', 'networks', 'heatmap-speed'].map(suffix => `/plans/${item}/${suffix}`))),
      bssidSelection: () => sequence([...radios.slice(0, 3), radios[0]].map(bssid => `${heatmapPath}?bssid=${encodeURIComponent(bssid)}`)),
      repeatedAnalysis: () => sequence(Array(6).fill(analysisPath)),
      campaign: async index => {
        await sequence([historyPath, heatmapPath, routes.seen[0]]);
        const scan = recordScan(index);
        await sequence([historyPath, heatmapPath, routes.seen[0]]);
        addSpeed(scan);
        await sequence([routes.speedPlan[0], historyPath]);
        updateRule(index);
        await sequence([heatmapPath, analysisPath, routes.seen[0]]);
      },
      concurrentClients: async () => {
        for (let index = 0; index < 3; index++) {
          await Promise.all(clients.map((_, client) => request(client % 2 ? historyPath : heatmapPath, client)));
        }
      },
    };
    const mixedOperations = [10, 30, 50].map(percent => [`mixed${100 - percent}-${percent}`, async index => {
      const reads = [historyPath, heatmapPath, analysisPath, routes.networksPlan[0], routes.speedPlan[0], routes.seen[0]];
      let written = 0, scan;
      for (let step = 0; step < options.mixedOperations; step++) {
        if (Math.floor((step + 1) * percent / 100) === Math.floor(step * percent / 100)) {
          await request(reads[step % reads.length]);
        } else {
          const next = written++ % 3;
          if (next === 0) scan = recordScan(index * options.mixedOperations + step);
          else if (next === 1) addSpeed(scan);
          else updateRule(index + step);
        }
      }
      return { reads: options.mixedOperations - written, writes: written };
    }]);
    const journeyStats = {};
    for (const [name, journey] of [...Object.entries(journeys), ...mixedOperations]) {
      journeyStats[name] = {};
      for (const enabled of [false, true]) {
        restore(enabled);
        const times = [];
        let operationsPerPass;
        for (let index = 0; index < options.journeyRuns; index++) {
          const start = performance.now();
          operationsPerPass = await journey(index);
          times.push(performance.now() - start);
        }
        const stats = memoryCache.stats();
        journeyStats[name][enabled ? 'enabled' : 'disabled'] = {
          ...summarize(times), cache: stats, ...(operationsPerPass ? { operationsPerPass } : {}),
        };
        if (name.startsWith('mixed') || name === 'campaign') {
          const endpoints = [heatmapPath, analysisPath, routes.seen[0], historyPath, routes.speedPlan[0]];
          const before = [];
          for (const endpoint of endpoints) before.push(await request(endpoint));
          mode(false);
          for (const [index, endpoint] of endpoints.entries()) assert.ok(before[index].equals(await request(endpoint)));
        }
      }
    }

    process.stderr.write(`[${volume}] Mémoire\n`);
    restore(true);
    const snapshotMemory = () => {
      const beforeGc = process.memoryUsage();
      global.gc?.();
      return { beforeGc, afterGc: process.memoryUsage(), cache: memoryCache.stats() };
    };
    const memory = { empty: snapshotMemory(), rounds: [] };
    // Start each round with large unfiltered entries, then cycle through disjoint filter sets.
    for (let round = 0; round < options.filterRounds; round++) {
      for (const [index, planId] of planIds.entries()) {
        scans.heatmapByPlan(planId);
        scans.heatmapBySurvey(id('survey', index));
      }
      const afterUnfiltered = { process: process.memoryUsage(), cache: memoryCache.stats() };
      for (let index = 0; index < 360; index++) {
        const planId = planIds[index % planIds.length];
        const ssid = `SSID-${(Math.floor(index / planIds.length) % 20) + 1}`;
        const filters = index % 4 === 0 ? { ssid, band: round % 2 ? '5GHz' : '2.4GHz' }
          : { ssid, bssid: `02:00:${round.toString(16).padStart(2, '0')}:${(index >> 8).toString(16).padStart(2, '0')}:${(index & 255).toString(16).padStart(2, '0')}:ff` };
        scans.heatmapByPlan(planId, filters);
      }
      const sampled = snapshotMemory();
      assert.ok(sampled.cache.entries <= 300 && sampled.cache.estimatedSizeBytes <= 64 * 1024 ** 2);
      memory.rounds.push({ afterUnfiltered, ...sampled });
    }
    // Deterministic engine checks complement the real heatmap stress above.
    let now = 0;
    const limits = createMemoryCache({ now: () => now });
    const slab = Buffer.alloc(7 * 1024 ** 2);
    for (let index = 0; index < 10; index++) assert.ok(limits.set(`limit:${index}`, slab));
    assert.equal(limits.set('oversized', Buffer.alloc(8 * 1024 ** 2)), false);
    assert.ok(limits.stats().evictions > 0 && limits.stats().estimatedSizeBytes <= 64 * 1024 ** 2);
    now = 59_999;
    assert.equal(limits.get('limit:9'), slab);
    now = 60_000;
    assert.equal(limits.get('limit:9'), undefined);
    memory.limitChecks = limits.stats();

    return { options, counts, dbBytes: statSync(snapshot).size, reads, writes, journeys: journeyStats, memory };
  } finally {
    console.log = originalLog;
    for (const client of clients) client.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    closeDb?.();
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (args.worker) {
  console.log(JSON.stringify(await runVolume(args.worker)));
} else {
  const volumes = args.volume ? args.volume.split(',') : Object.keys(presets);
  const results = {};
  for (const volume of volumes) {
    optionsFor(volume);
    const child = spawn(process.execPath, ['--expose-gc', script, ...process.argv.slice(2), `--worker=${volume}`], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let json = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { json += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, `Volume ${volume} en échec`);
    results[volume] = JSON.parse(json);
  }
  const output = args.output ?? path.join(backend, '..', 'benchmarks', 'phase4d-backend.json');
  writeFileSync(output, JSON.stringify({
    generatedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, platform: process.platform,
    units: { latency: 'ms', memory: 'bytes' },
    methodology: {
      read: 'Modes contrôlés par les compteurs. Parité JSON octet par octet. HTTP local avec connexions persistantes.',
      cold: 'Fermeture SQLite avant chaque essai, cache désactivé, cache disque OS conservé.',
      write: 'Instantané SQLite restauré avant chaque opération. Lectures préalables dans les deux modes, phase de préparation hors chronomètre.',
      mixed: 'Écritures repository, lectures HTTP. Rapports synthétiques. Les passes se succèdent sur une même base restaurée par mode.',
      memory: 'Processus par volume. Échantillons avant et après GC forcé aux points de contrôle.',
    }, results,
  }, null, 2) + '\n');
  console.log(output);
}
