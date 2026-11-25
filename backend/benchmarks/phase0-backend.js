import { mkdtempSync, mkdirSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem, platform, release } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { seedDatabase, summarize } from './backend-fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUTPUT_DIR = path.join(ROOT, 'benchmarks');

function parseArgs(argv) {
  const options = {
    plans: 20,
    pointsPerPlan: 30,
    scansPerPoint: 1,
    observationsPerScan: 15,
    bssids: 200,
    iterations: 15,
    warmup: 3,
    keep: false,
    output: 'phase0-backend.json',
  };
  for (const raw of argv) {
    if (raw === '--keep') {
      options.keep = true;
      continue;
    }
    const match = /^--([^=]+)=(.+)$/.exec(raw);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === 'output') {
      options.output = value;
      continue;
    }
    if (key in options) {
      options[key] = key === 'keep' ? value === 'true' : Number(value);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const tmp = mkdtempSync(path.join(tmpdir(), 'heatmap-phase0-'));
process.env.DB_PATH = path.join(tmp, 'bench.db');
process.env.BACKEND_CACHE_ENABLED = 'false';
process.env.PORT = '0';
process.env.CORS_ORIGIN = '*';
process.env.SCAN_MODE = 'test';
process.env.RATE_LIMIT_API = '1000000';
process.env.RATE_LIMIT_SCAN = '1000000';
process.env.SKIP_GATEWAY_PING = '1';

const { getDb, closeDb } = await import('../src/database/db.js');

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function measureSync(fn, warmup, iterations) {
  for (let index = 0; index < warmup; index += 1) fn();
  const times = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return summarize(times);
}

function measureCold(fn) {
  closeDb();
  const openStart = performance.now();
  getDb();
  const openMs = performance.now() - openStart;
  const start = performance.now();
  const value = fn();
  const queryMs = performance.now() - start;
  return {
    openMs: round(openMs),
    queryMs: round(queryMs),
    rows: Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0,
    bytes: Buffer.byteLength(JSON.stringify(value ?? null)),
  };
}

const seedStart = performance.now();
const db = getDb();
seedDatabase(db, options);
const seedMs = performance.now() - seedStart;

const plansRepo = await import('../src/repositories/plans.repository.js');
const surveysRepo = await import('../src/repositories/surveys.repository.js');
const scanPointsRepo = await import('../src/repositories/scanPoints.repository.js');
const accessPointsRepo = await import('../src/repositories/accessPoints.repository.js');
const polygonsRepo = await import('../src/repositories/polygons.repository.js');
const apPositionsRepo = await import('../src/repositories/apPositions.repository.js');
const apMappingsRepo = await import('../src/repositories/apMappings.repository.js');
const scansRepo = await import('../src/repositories/scans.repository.js');
const bssidRulesRepo = await import('../src/repositories/bssidRules.repository.js');
const settingsRepo = await import('../src/repositories/settings.repository.js');
const analysisRepo = await import('../src/repositories/analysis.repository.js');

const firstPlan = plansRepo.listPlans()[0];
const planId = firstPlan.id;
const surveyId = surveysRepo.listSurveysByPlan(planId)[0].id;
const pointId = scanPointsRepo.listScanPointsByPlan(planId)[0].id;
const scanId = scansRepo.listScansByPoint(pointId)[0].id;
const withNamesRows = scansRepo
  .heatmapByPlan(planId)
  .slice(0, 200)
  .map(({ bssid }) => ({ bssid }));

const sqlTargets = [
  ['plans.list', () => plansRepo.listPlans()],
  ['plans.get', () => plansRepo.findPlanById(planId)],
  ['surveys.listByPlan', () => surveysRepo.listSurveysByPlan(planId)],
  ['scanPoints.listByPlan', () => scanPointsRepo.listScanPointsByPlan(planId)],
  ['accessPoints.listByPlan', () => accessPointsRepo.listAccessPointsByPlan(planId)],
  ['polygons.listByPlan', () => polygonsRepo.listPolygonsByPlan(planId)],
  ['apPositions.listByPlan', () => apPositionsRepo.listApPositionsByPlan(planId)],
  ['apMappings.listByPlan', () => apMappingsRepo.listMappingsByPlan(planId)],
  ['scans.historyByPlan', () => scansRepo.getHistoryByPlan(planId)],
  ['scans.historyBySurvey', () => scansRepo.getHistoryBySurvey(surveyId)],
  ['scans.heatmapByPlan', () => scansRepo.heatmapByPlan(planId)],
  ['scans.heatmapByPlan.band5', () => scansRepo.heatmapByPlan(planId, { band: '5GHz' })],
  ['scans.networksByPlan', () => scansRepo.listNetworksByPlan(planId)],
  ['scans.speedByPlan', () => scansRepo.speedByPlan(planId)],
  ['scans.observationsByScan', () => scansRepo.listObservationsByScan(scanId)],
  ['scans.scansByPoint', () => scansRepo.listScansByPoint(pointId)],
  ['bssidRules.list', () => bssidRulesRepo.listBssidRules()],
  ['bssidRules.seen', () => bssidRulesRepo.listAllSeenBssids()],
  ['bssidRules.withNames', () => bssidRulesRepo.withBssidNames(withNamesRows)],
  ['settings.getAll', () => settingsRepo.getAllSettings()],
  ['analysis.strongestBySurvey', () => analysisRepo.listStrongestObservationsBySurvey(surveyId)],
];

const sqlCold = {};
const sqlWarm = {};
for (const [name, fn] of sqlTargets) {
  sqlCold[name] = measureCold(fn);
}
for (const [name, fn] of sqlTargets) {
  sqlWarm[name] = measureSync(fn, options.warmup, options.iterations);
}

const { default: app } = await import('../src/app.js');
const originalConsoleLog = console.log;
console.log = () => {};
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function requestOnce(requestPath) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET', agent, headers: { connection: 'keep-alive' } },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          bytes += chunk.length;
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            ms: performance.now() - start,
            status: response.statusCode ?? 0,
            bytes,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}

const apiEndpoints = [
  ['GET /api/v1/plans', '/api/v1/plans'],
  ['GET /api/v1/plans/:id', `/api/v1/plans/${planId}`],
  ['GET /api/v1/plans/:id/surveys', `/api/v1/plans/${planId}/surveys`],
  ['GET /api/v1/plans/:id/scan-points', `/api/v1/plans/${planId}/scan-points`],
  ['GET /api/v1/plans/:id/access-points', `/api/v1/plans/${planId}/access-points`],
  ['GET /api/v1/plans/:id/polygons', `/api/v1/plans/${planId}/polygons`],
  ['GET /api/v1/plans/:id/aps', `/api/v1/plans/${planId}/aps`],
  ['GET /api/v1/plans/:id/ap-mappings', `/api/v1/plans/${planId}/ap-mappings`],
  ['GET /api/v1/plans/:id/history', `/api/v1/plans/${planId}/history`],
  ['GET /api/v1/plans/:id/heatmap', `/api/v1/plans/${planId}/heatmap`],
  ['GET /api/v1/plans/:id/heatmap?band=5', `/api/v1/plans/${planId}/heatmap?band=5`],
  ['GET /api/v1/plans/:id/heatmap?connected=1', `/api/v1/plans/${planId}/heatmap?connected=1`],
  ['GET /api/v1/plans/:id/networks', `/api/v1/plans/${planId}/networks`],
  ['GET /api/v1/plans/:id/heatmap-speed', `/api/v1/plans/${planId}/heatmap-speed`],
  ['GET /api/v1/surveys/:id/history', `/api/v1/surveys/${surveyId}/history`],
  ['GET /api/v1/surveys/:id/heatmap', `/api/v1/surveys/${surveyId}/heatmap`],
  ['GET /api/v1/surveys/:id/networks', `/api/v1/surveys/${surveyId}/networks`],
  ['GET /api/v1/surveys/:id/heatmap-speed', `/api/v1/surveys/${surveyId}/heatmap-speed`],
  ['GET /api/v1/scan/scans/:scanId', `/api/v1/scan/scans/${scanId}`],
  ['GET /api/v1/bssid-rules', '/api/v1/bssid-rules'],
  ['GET /api/v1/bssid-rules/seen', '/api/v1/bssid-rules/seen'],
  ['GET /api/v1/settings', '/api/v1/settings'],
  ['GET /api/v1/status', '/api/v1/status'],
];

await requestOnce('/api/v1/health');
const apiCold = {};
const apiWarm = {};
for (const [name, requestPath] of apiEndpoints) {
  const cold = await requestOnce(requestPath);
  apiCold[name] = {
    ms: round(cold.ms),
    status: cold.status,
    bytes: cold.bytes,
  };
}
for (const [name, requestPath] of apiEndpoints) {
  for (let index = 0; index < options.warmup; index += 1) await requestOnce(requestPath);
  const times = [];
  let bytes = 0;
  let status = 0;
  for (let index = 0; index < options.iterations; index += 1) {
    const result = await requestOnce(requestPath);
    times.push(result.ms);
    bytes = result.bytes;
    status = result.status;
  }
  apiWarm[name] = { ...summarize(times), status, bytes };
}

async function surveysLibraryPass() {
  const plans = JSON.parse((await requestOnce('/api/v1/plans')).body);
  const start = performance.now();
  await Promise.all(
    plans.map((plan) =>
      Promise.all([
        requestOnce(`/api/v1/plans/${plan.id}/history`),
        requestOnce(`/api/v1/plans/${plan.id}/heatmap`),
        requestOnce(`/api/v1/plans/${plan.id}/ap-mappings`),
      ])
    )
  );
  return performance.now() - start;
}

async function surveysLibrarySequentialPass() {
  const plans = JSON.parse((await requestOnce('/api/v1/plans')).body);
  const start = performance.now();
  for (const plan of plans) {
    await requestOnce(`/api/v1/plans/${plan.id}/history`);
    await requestOnce(`/api/v1/plans/${plan.id}/heatmap`);
    await requestOnce(`/api/v1/plans/${plan.id}/ap-mappings`);
  }
  return performance.now() - start;
}

async function channelAnalysisPass() {
  const start = performance.now();
  const history = JSON.parse((await requestOnce(`/api/v1/plans/${planId}/history`)).body);
  const scanIds = [
    ...new Set(
      history
        .map((point) => point.scans[point.scans.length - 1]?.id)
        .filter((id) => typeof id === 'string')
    ),
  ];
  let next = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (next < scanIds.length) {
      const id = scanIds[next];
      next += 1;
      await requestOnce(`/api/v1/scan/scans/${id}`);
    }
  });
  await Promise.all(workers);
  return performance.now() - start;
}

async function scenarioPass(fn, iterations = 3) {
  for (let index = 0; index < 1; index += 1) await fn();
  const times = [];
  for (let index = 0; index < iterations; index += 1) {
    times.push(await fn());
  }
  return summarize(times);
}

const scenarios = {
  surveysLibraryConcurrent: await scenarioPass(surveysLibraryPass),
  surveysLibrarySequential: await scenarioPass(surveysLibrarySequentialPass),
  channelAnalysis: await scenarioPass(channelAnalysisPass),
};

agent.destroy();
await new Promise((resolve) => server.close(resolve));
console.log = originalConsoleLog;

const dbPath = process.env.DB_PATH;
const walPath = `${dbPath}-wal`;
const dbSizeBytes = statSync(dbPath).size;
const walSizeBytes = existsSync(walPath) ? statSync(walPath).size : 0;

const results = {
  phase: 0,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  config: {
    iterations: options.iterations,
    warmup: options.warmup,
  },
  scenario: {
    plans: options.plans,
    pointsPerPlan: options.pointsPerPlan,
    scansPerPoint: options.scansPerPoint,
    observationsPerScan: options.observationsPerScan,
    bssids: options.bssids,
    iterations: options.iterations,
    warmup: options.warmup,
    keep: options.keep,
  },
  seedMs: round(seedMs),
  database: {
    sizeBytes: dbSizeBytes,
    walSizeBytes,
    plans: options.plans,
    scanPoints: options.plans * options.pointsPerPlan,
    scans: options.plans * options.pointsPerPlan * options.scansPerPoint,
    observations:
      options.plans * options.pointsPerPlan * options.scansPerPoint * options.observationsPerScan,
    bssids: options.bssids,
  },
  volumetry: {
    plans: options.plans,
    pointsPerPlan: options.pointsPerPlan,
    scansPerPoint: options.scansPerPoint,
    observationsPerScan: options.observationsPerScan,
    bssids: options.bssids,
    scanPoints: options.plans * options.pointsPerPlan,
    scans: options.plans * options.pointsPerPlan * options.scansPerPoint,
    observations:
      options.plans * options.pointsPerPlan * options.scansPerPoint * options.observationsPerScan,
    dbSizeBytes,
    walSizeBytes,
  },
  methodology: {
    sqlCold: 'closeDb(), réouverture, puis première exécution de la requête',
    sqlWarm: `${options.warmup} warmups + ${options.iterations} itérations mesurées (p50/p95)`,
    apiCold: 'premier appel HTTP de chaque endpoint, après /api/v1/health',
    apiWarm: `${options.warmup} warmups + ${options.iterations} itérations mesurées (p50/p95)`,
  },
  sql: { cold: sqlCold, warm: sqlWarm },
  api: { cold: apiCold, warm: apiWarm, scenarios },
};

mkdirSync(OUTPUT_DIR, { recursive: true });
const outputPath = path.join(OUTPUT_DIR, options.output);
writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);

const table = (entries) =>
  Object.fromEntries(
    Object.entries(entries).map(([name, stats]) => [
      name,
      { p50: stats.p50, p95: stats.p95, max: stats.max, bytes: stats.bytes ?? stats.rows ?? '' },
    ])
  );

console.log('Phase 0 backend');
console.log('Scenario', JSON.stringify(results.scenario));
console.log('Database', JSON.stringify(results.database));
console.log('SQL warm (ms)');
console.table(table(sqlWarm));
console.log('API warm (ms)');
console.table(table(apiWarm));
console.log('Scenarios (ms)');
console.table(scenarios);
console.log('Results written to', outputPath);

closeDb();
if (options.keep) {
  console.log('Benchmark database kept at', tmp);
} else {
  rmSync(tmp, { recursive: true, force: true });
}
