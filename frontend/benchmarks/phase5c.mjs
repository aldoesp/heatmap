import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build, createServer, preview } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'heatmap-phase5c-'));
const output = process.argv[2] ?? join(root, '../benchmarks/phase5c-frontend.json');
const runs = Number(process.env.PHASE5C_RUNS ?? 5);
assert.ok(Number.isSafeInteger(runs) && runs > 0);
const executable = process.env.CHROMIUM ?? 'chromium';
const raster = 'img.leaflet-image-layer[src^="blob:"]';
const modes = ['direct', 'dedup', 'synced'];
const wifi = { latency: 45, downloadThroughput: 12_000_000 / 8, uploadThroughput: 4_000_000 / 8 };
const vertices = [{ x: 0.02, y: 0.02 }, { x: 0.98, y: 0.02 }, { x: 0.98, y: 0.98 }, { x: 0.02, y: 0.98 }];
const radio = letter => '02:00:00:00:00:0' + (letter.charCodeAt(0) - 64);

function benchmarkPlugin() {
  return {
    name: 'phase5c-benchmark-only',
    enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/lib/apiRead.ts')) {
        const anchor = '    this.keys.add(key);';
        assert.ok(source.includes(anchor));
        return source.replace(anchor, anchor + `
    if (globalThis.__phase5cMode === 'direct') {
      this.checks.push(apiCache.captureCurrent(key));
      return loader(forceRefresh);
    }`) + '\nglobalThis.__phase5cStats = () => apiCache.stats();';
      }
      if (id.endsWith('/src/lib/apiSync.ts')) {
        const anchor = 'export function startApiSync() {';
        assert.ok(source.includes(anchor));
        return source.replace(anchor, anchor + "\n  if (globalThis.__phase5cMode !== 'synced') return () => {};");
      }
      if (id.endsWith('/src/main.tsx')) {
        return source + `
import { setActivePlanId } from './lib/storage';
import { createScanPoint, saveScanAtPoint, deleteScanPoint, updatePolygon, updateBssidRule } from './lib/api';
globalThis.__phase5c = { setActivePlanId, createScanPoint, saveScanAtPoint, deleteScanPoint, updatePolygon, updateBssidRule };`;
      }
    },
  };
}

async function waitFor(label, callback, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await callback();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('Délai dépassé · ' + label);
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

function seed(db, cache) {
  db.transaction(() => {
    db.exec('DELETE FROM plans; DELETE FROM bssid_rules; DELETE FROM settings WHERE key = \'iperf_duration_s\'');
    const plan = db.prepare(`INSERT INTO plans (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes)
      VALUES (?, ?, 'synthetic.svg', 'synthetic.svg', '/uploads/phase5c.svg', 'image/png', 480, 320, 100)`);
    const survey = db.prepare('INSERT INTO surveys (id, name, plan_id) VALUES (?, ?, ?)');
    const point = db.prepare('INSERT INTO scan_points (id, plan_id, survey_id, x, y) VALUES (?, ?, ?, ?, ?)');
    const scan = db.prepare("INSERT INTO scans (id, scan_point_id, plan_id, mode, scanned_at) VALUES (?, ?, ?, 'test', '2026-01-01')");
    const observation = db.prepare(`INSERT INTO observations (scan_id, bssid, ssid, band, frequency_mhz, channel, rssi, quality, level, security, standard)
      VALUES (?, ?, ?, ?, ?, ?, ?, 60, 'fair', 'WPA2', 'ax')`);
    const polygon = db.prepare('INSERT INTO polygons (id, plan_id, vertices) VALUES (?, ?, ?)');
    for (const letter of ['A', 'B', 'C']) {
      db.prepare('INSERT INTO bssid_rules (id, bssid, name) VALUES (?, ?, ?)').run(letter, radio(letter), 'Radio ' + letter);
    }
    for (const letter of ['A', 'B']) {
      plan.run(letter, 'Plan ' + letter);
      survey.run('survey-' + letter, 'Campagne ' + letter, letter);
      polygon.run('polygon-' + letter, letter, JSON.stringify(vertices));
      for (let index = 0; index < 12; index++) {
        const id = letter + '-' + index;
        point.run(id, letter, 'survey-' + letter, 0.15 + (index % 4) * 0.23, 0.18 + Math.floor(index / 4) * 0.3);
        scan.run('scan-' + id, id, letter);
        [...'ABC'].forEach((name, channel) => {
          observation.run('scan-' + id, radio(name), 'Laboratoire', channel ? '5GHz' : '2.4GHz',
            channel ? 5180 + channel * 20 : 2437, channel ? 36 + channel * 4 : 6,
            -38 - (index * (channel + 3) + channel * 9) % 39);
        });
      }
    }
  })();
  cache.clear();
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  const subscribers = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      subscribers.get(message.sessionId)?.(message.method, message.params);
    }
  });
  return {
    close: () => socket.close(),
    subscribe: (sessionId, handle) => subscribers.set(sessionId, handle),
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
  };
}

async function newPage(cdp, mode, simulateWifi) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  const requests = [];
  const businessById = new Map();
  cdp.subscribe(sessionId, (event, data) => {
    if (event === 'Network.requestWillBeSent') {
      const url = new URL(data.request.url);
      if (!url.pathname.startsWith('/api/v1/')) return;
      const entry = {
        url: url.pathname + url.search, sync: url.pathname === '/api/v1/revision',
        method: data.request.method, bytes: 0,
      };
      requests.push(entry);
      businessById.set(data.requestId, entry);
    } else if (event === 'Network.loadingFinished' && businessById.has(data.requestId)) {
      Object.assign(businessById.get(data.requestId), { bytes: data.encodedDataLength, finished: true });
    } else if (event === 'Network.loadingFailed' && businessById.has(data.requestId)) {
      Object.assign(businessById.get(data.requestId), { status: 599, finished: true });
    } else if (event === 'Network.responseReceived' && businessById.has(data.requestId)) {
      businessById.get(data.requestId).status = data.response.status;
    }
  });
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (simulateWifi) await send('Network.emulateNetworkConditions', { offline: false, ...wifi, connectionType: 'wifi' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__phase5cMode = ${JSON.stringify(mode)};
    window.__phase5cBuilds = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message?.type === 'build') window.__phase5cBuilds++;
      return post.call(this, message, ...args);
    };
    if (location.protocol === 'http:') localStorage.setItem('heatmap:activePlanId', 'A');
    window.__phase5cDocument = Math.random();
  ` });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? expression);
    return result.result.value;
  };
  return {
    evaluate, requests,
    navigate: url => send('Page.navigate', { url }),
    until: (label, expression, timeout) => waitFor(label, () => evaluate(expression), timeout),
    close: () => cdp.send('Target.disposeBrowserContext', { browserContextId }),
  };
}

const expression = (fn, ...args) => `(${fn})(...${JSON.stringify(args)})`;
const click = (page, selector) => page.evaluate(expression(selector => document.querySelector(selector).click(), selector));
const clickText = (page, label, selector = 'button') => page.evaluate(expression((query, label) => {
  [...document.querySelectorAll(query)].find(element => element.textContent.trim() === label).click();
}, selector, label));
const setRoute = (page, route) => page.evaluate(`location.hash = '#/${route}'`);
const title = name => `document.querySelector('h1')?.textContent?.trim() === ${JSON.stringify(name)}`;
const snapshot = page => page.evaluate('({ ...window.__phase5cStats(), builds: window.__phase5cBuilds })');
const pretty = (value) => Math.round(value * 10) / 10;
const percentile = (values, p) => values.length ? pretty([...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1]) : null;

async function overlay(page, name, previous = '', pointCount = null) {
  return page.until('raster · ' + name, expression((selector, expected, previous, pointCount) => {
    const image = document.querySelector(selector);
    const summary = document.querySelector('h1')?.nextElementSibling?.textContent;
    if (pointCount !== null && document.querySelectorAll('path[fill="#0d1319"]').length !== pointCount) return null;
    return summary?.includes(expected) && image?.complete && image.naturalWidth && image.src !== previous ? image.src : null;
  }, raster, name, previous, pointCount));
}

async function fingerprint(page) {
  return page.evaluate(expression(async selector => {
    const image = document.querySelector(selector);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = await crypto.subtle.digest('SHA-256', pixels);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }, raster));
}

async function networkMetrics(requests) {
  await waitFor('fin des requêtes API', () => requests.every(entry => entry.finished));
  const failures = requests.filter(entry => entry.status >= 400);
  assert.deepEqual(failures, [], 'Une requête API a échoué');
  const sync = requests.filter(entry => entry.sync);
  const business = requests.filter(entry => !entry.sync);
  const bytes = entries => entries.reduce((total, entry) => total + entry.bytes, 0);
  return {
    business: business.length, polling: sync.length, total: requests.length,
    businessBytes: bytes(business), pollingBytes: bytes(sync), totalBytes: bytes(requests),
  };
}

async function collect(page, base, mode, run) {
  const samples = {};
  const first = performance.now();
  await page.navigate(base + '/#/heatmap');
  let src = await overlay(page, 'Plan A');
  samples.firstLoad = [performance.now() - first];

  async function measure(name, action) {
    const start = performance.now();
    await action();
    (samples[name] ??= []).push(performance.now() - start);
  }
  for (const letter of ['B', 'A', 'B', 'A']) {
    await measure('plans', async () => {
      await page.evaluate(`__phase5c.setActivePlanId('${letter}')`);
      src = await overlay(page, 'Plan ' + letter, src);
    });
  }

  await click(page, '[aria-controls="heatmap-display-options"]');
  for (const letter of ['A', 'B', 'C', 'A']) {
    await measure('bssid', async () => {
      await click(page, '#heatmap-display-options button[aria-haspopup="listbox"]');
      await page.until('radio ' + letter, 'document.querySelector("[role=option]") !== null');
      await clickText(page, 'Radio ' + letter, '[role=option]');
      src = await overlay(page, 'Plan A', src);
    });
  }

  const benchCard = 'button[aria-label="Plus d\'actions pour Plan A"]';
  for (let iteration = 0; iteration < 2; iteration++) {
    await measure('library', async () => {
      await setRoute(page, 'surveys');
      await page.until('bibliothèque', `document.querySelector(${JSON.stringify(benchCard)}) !== null`);
    });
    await measure('scanDetails', async () => {
      await click(page, benchCard);
      await page.until('actions du relevé', 'document.querySelector("[role=dialog]") !== null');
      await clickText(page, 'Voir les points');
      await page.until('détails des scans', `${title('Points · Plan A')} && document.querySelector('tbody')?.textContent.includes('Laboratoire') && !document.querySelector('h1 + p')?.textContent.includes('chargement')`);
    });
    await measure('channels', async () => {
      await setRoute(page, 'channels');
      await page.until('analyse des canaux', `${title('Analyseur Wi-Fi')} && document.body.textContent.includes('Laboratoire')`);
    });
  }

  await setRoute(page, 'releves');
  await page.until('campagne initiale', `${title('Relevés')} && document.body.textContent.includes('12 scans')`);
  for (let index = 0; index < 2; index++) {
    await measure('rssiCampaign', async () => {
      await page.evaluate(expression(async index => {
        const p = await window.__phase5c.createScanPoint('A', 0.22 + index * 0.05, 0.28);
        await window.__phase5c.saveScanAtPoint(p.id, 'A');
      }, index));
      await page.until('scan enregistré', `document.body.textContent.includes('${13 + index} scans')`);
    });
  }

  return { mode, run, samples, cache: await snapshot(page), network: await networkMetrics(page.requests.slice()) };
}

async function remoteTest(reader, writer, base, mode, run) {
  await setRoute(reader, 'heatmap');
  let src = await overlay(reader, 'Plan A', '', 14);
  const documentId = await reader.evaluate('__phase5cDocument');
  await writer.navigate(base + '/#/account');
  await writer.until('API du second contexte', 'Boolean(window.__phase5c)');
  assert.equal(await reader.evaluate('document.hidden'), false);
  assert.notEqual(await writer.evaluate('__phase5cDocument'), documentId);
  await writer.evaluate("__phase5c.setActivePlanId('B')");
  assert.equal(await reader.evaluate("localStorage.getItem('heatmap:activePlanId')"), 'A');
  await sleep(160 + run * 730);
  const before = await fingerprint(reader);
  const beforeBuilds = (await snapshot(reader)).builds;
  const requestIndex = reader.requests.length;
  const start = performance.now();
  const { pointId, scanId } = await writer.evaluate(`(async () => {
    const point = await __phase5c.createScanPoint('A', 0.93, 0.9);
    const scan = await __phase5c.saveScanAtPoint(point.id, 'A');
    return { pointId: point.id, scanId: scan.scan_id };
  })()`);
  const received = performance.now();
  assert.ok(scanId);
  if (mode !== 'synced') {
    await sleep(5_300);
    assert.equal(await fingerprint(reader), before);
    assert.equal(documentId, await reader.evaluate('__phase5cDocument'));
    return { automaticallyRefreshed: false, observedMs: 5_300, network: await networkMetrics(reader.requests.slice(requestIndex)) };
  }

  src = await overlay(reader, 'Plan A', src, 15);
  const visible = performance.now();
  assert.notEqual(await fingerprint(reader), before);
  assert.equal(documentId, await reader.evaluate('__phase5cDocument'));
  const result = {
    automaticallyRefreshed: true, writeToVisibleMs: pretty(visible - start),
    responseToVisibleMs: pretty(visible - received), network: await networkMetrics(reader.requests.slice(requestIndex)),
    rasterBuilds: (await snapshot(reader)).builds - beforeBuilds,
  };
  if (run !== 0) return result;

  const afterScan = await fingerprint(reader);
  const builds = (await snapshot(reader)).builds;
  await writer.evaluate("__phase5c.updateBssidRule('A', { name: 'Radio A distante' })");
  src = await overlay(reader, 'Plan A', src, 15);
  await click(reader, '[aria-controls="heatmap-display-options"]');
  await click(reader, '#heatmap-display-options button[aria-haspopup="listbox"]');
  await reader.until('alias BSSID distant visible', 'document.querySelector("[role=listbox]")?.textContent.includes("Radio A distante")');
  assert.equal(await fingerprint(reader), afterScan);
  assert.equal((await snapshot(reader)).builds, builds);
  await click(reader, '#heatmap-display-options button[aria-haspopup="listbox"]');

  await writer.evaluate(`__phase5c.deleteScanPoint('A', ${JSON.stringify(pointId)})`);
  src = await overlay(reader, 'Plan A', src, 14);
  const afterDelete = await fingerprint(reader);
  assert.equal(afterDelete, before);
  await writer.evaluate(`__phase5c.updatePolygon('polygon-A', ${JSON.stringify(vertices.map(vertex => ({ ...vertex, x: Math.min(vertex.x, 0.7) })))}, 'A')`);
  await overlay(reader, 'Plan A', src, 14);
  assert.notEqual(await fingerprint(reader), afterDelete);
  assert.equal(documentId, await reader.evaluate('__phase5cDocument'));
  result.assertions = ['remoteScanAndPixels', 'bssidAliasAndRasterReuse', 'pointDeletionAndPixels', 'polygonAndPixels'];
  return result;
}

function summarise(rounds) {
  return Object.fromEntries(modes.map(mode => {
    const items = rounds.filter(round => round.mode === mode);
    const durations = Object.fromEntries(Object.keys(items[0].samples).map(key => {
      const values = items.flatMap(item => item.samples[key]);
      return [key, { n: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) }];
    }));
    const sumNetwork = field => Object.fromEntries(Object.keys(items[0][field].network ?? items[0][field]).map(key => [
      key, items.reduce((sum, item) => sum + ((item[field]?.network ?? item[field])?.[key] ?? 0), 0),
    ]));
    const remote = items.flatMap(item => item.remote?.automaticallyRefreshed ? [item.remote.responseToVisibleMs] : []);
    const hits = items.reduce((sum, item) => sum + item.cache.hits, 0);
    const misses = items.reduce((sum, item) => sum + item.cache.misses, 0);
    return [mode, {
      durations, network: sumNetwork('network'), remoteNetwork: sumNetwork('remote'),
      hits, misses, hitRate: hits + misses ? hits / (hits + misses) : null,
      coalesced: items.reduce((sum, item) => sum + item.cache.coalescedRequests, 0),
      estimatedMaxCacheBytesAtEnd: Math.max(...items.map(item => item.cache.estimatedSizeBytes)),
      rasterBuilds: items.reduce((sum, item) => sum + item.cache.builds, 0),
      remote: { checks: items.filter(item => item.remote).length, visible: remote.length, p50Ms: percentile(remote, .5), p95Ms: percentile(remote, .95) },
    }];
  }));
}

let backend, dev, server, chromium, cdp, closeDb;
try {
  process.env.DB_PATH = join(temp, 'bench.db');
  process.env.SCAN_MODE = 'test';
  process.env.SKIP_GATEWAY_PING = '1';
  process.env.BACKEND_CACHE_ENABLED = process.env.PHASE5C_BACKEND_CACHE ?? 'true';
  // Toutes les répétitions et tous les contextes partagent l’IP loopback.
  process.env.RATE_LIMIT_API = '10000';
  process.env.RATE_LIMIT_SCAN = '2000';
  const { default: app } = await import('../../backend/src/app.js');
  const dbModule = await import('../../backend/src/database/db.js');
  closeDb = dbModule.closeDb;
  const db = dbModule.getDb();
  const { memoryCache } = await import('../../backend/src/cache/memoryCache.js');
  backend = createHttpServer((req, res) => {
    if (req.url !== '/uploads/phase5c.svg') return app(req, res);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#e5e4db"/></svg>');
  });
  process.env.BACKEND_URL = await listen(backend);
  const config = { root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' };
  const outDir = join(temp, 'dist');
  const startOptions = { host: '127.0.0.1', port: 0 };
  await build({
    ...config, plugins: [benchmarkPlugin()], build: { outDir, emptyOutDir: true },
    define: {
      'import.meta.env.VITE_API_CACHE_ENABLED': JSON.stringify('true'),
      'import.meta.env.VITE_API_BASE': JSON.stringify(''),
      'import.meta.env.VITE_API_SYNC_INTERVAL_MS': JSON.stringify('5000'),
    },
  });
  server = await preview({ ...config, build: { outDir }, preview: startOptions });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  process.env.NODE_ENV = 'development';
  dev = await createServer({ ...config, cacheDir: join(temp, 'vite-dev'), server: startOptions });
  await dev.listen();
  chromium = spawn(executable, [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--no-first-run', '--window-size=1360,880',
    '--remote-debugging-port=0', '--user-data-dir=' + join(temp, 'chrome'),
  ], { stdio: 'ignore' });
  const [port] = (await waitFor('port CDP Chromium', () => readFile(join(temp, 'chrome/DevToolsActivePort'), 'utf8').catch(() => false))).split('\n');
  const browser = await fetch('http://127.0.0.1:' + port + '/json/version').then(response => response.json());
  cdp = await connect(browser.webSocketDebuggerUrl);
  const legacy = await newPage(cdp, 'dedup', false);
  await legacy.navigate(new URL('/tests/apiRead.browser.html', dev.resolvedUrls.local[0]).href);
  const browserTest = await legacy.until('test React 5B', 'document.querySelector("#report")?.textContent.match(/^(PASS|FAIL).*/)?.[0]');
  assert.match(browserTest, /^PASS/);
  await legacy.close();
  console.log(browserTest);
  const rounds = [];
  for (let run = 0; run < runs; run++) {
    for (const mode of [...modes.slice(run % 3), ...modes.slice(0, run % 3)]) {
      seed(db, memoryCache);
      const page = await newPage(cdp, mode, true);
      try {
        const result = await collect(page, base, mode, run);
        if (mode === 'synced' || run === 0) {
          const writer = await newPage(cdp, mode, true);
          try { result.remote = await remoteTest(page, writer, base, mode, run); }
          finally { await writer.close(); }
        }
        rounds.push(result);
        console.log('phase5c', run + 1, mode, result.network, result.remote?.responseToVisibleMs ?? '');
      } catch (error) {
        console.error(await page.evaluate('document.body.innerText.slice(0, 1200)').catch(() => ''));
        throw error;
      } finally {
        await page.close();
      }
    }
  }
  const cpus = execFileSync('node', ['-p', 'JSON.stringify(require("node:os").cpus()[0]?.model)'], { encoding: 'utf8' });
  await writeFile(output, JSON.stringify({
    conditions: {
      browser: browser.Browser, node: process.version, cpu: JSON.parse(cpus), runs, wifi,
      viewport: '1360x880', fixture: '2 plans 480 × 320, 12 points par plan, 1 scan et 3 radios par point',
      backendCache: process.env.BACKEND_CACHE_ENABLED, pollingIntervalMs: 5000, percentile: 'nearest rank',
      rateLimitsPerMinute: { api: 10000, scan: 2000 },
      networkAccounting: 'HTTP /api/v1, réponses encodées CDP avec en-têtes, hors requêtes montantes',
    },
    browserTest, summary: summarise(rounds), rounds,
  }, null, 2) + '\n');
} finally {
  cdp?.close();
  if (chromium && chromium.exitCode === null) {
    chromium.kill();
    await once(chromium, 'exit').catch(() => {});
  }
  await dev?.close();
  await Promise.all([server?.httpServer, backend].filter(Boolean).map(active => new Promise(resolve => active.close(resolve))));
  closeDb?.();
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
}
