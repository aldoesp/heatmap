import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function backendProcess(root, { baseline }) {
  let process, origin;
  const application = pathToFileURL(join(root, '../backend/src/app.js')).href;
  const cache = pathToFileURL(join(root, '../backend/src/cache/memoryCache.js')).href;
  const script = `
    import app from ${JSON.stringify(application)};
    const cache = ${baseline ? 'null' : `await import(${JSON.stringify(cache)})`};
    const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
    process.on('message', () => process.send({ cache: cache?.memoryCache.stats(), memory: process.memoryUsage() }));
  `;
  async function stop() {
    if (process?.exitCode === null) {
      const exited = once(process, 'exit');
      process.kill();
      await exited;
    }
  }
  async function restart() {
    await stop();
    process = spawn('node', ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const [ready] = await Promise.race([
      once(process, 'message'),
      once(process, 'exit').then(([code]) => { throw new Error('Backend interrompu ' + code); }),
    ]);
    origin = 'http://127.0.0.1:' + ready.port;
  }
  await restart();
  return { origin: () => origin, restart, stop, async stats() {
    const pending = once(process, 'message');
    process.send('stats');
    return (await pending)[0];
  } };
}

export async function exportChecks(page, { clickText, temp, expectBlock, baseline }) {
  let downloadNumber = 0;
  const require = createRequire(new URL('../../backend/package.json', import.meta.url));
  const { unzipSync } = require('fflate');
  async function download(label, extension, timeout = 45000) {
    const directory = join(temp, 'downloads-' + page.browserContextId, String(downloadNumber++));
    await mkdir(directory, { recursive: true });
    await page.downloads(directory);
    const start = performance.now();
    await clickText(page, label);
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const file = (await readdir(directory)).find(name => name.endsWith(extension));
      if (file) return { bytes: await readFile(join(directory, file)), ms: performance.now() - start };
      await sleep(30);
    }
    throw new Error('Téléchargement bloqué · ' + label);
  }
  const pngShape = bytes => {
    const png = Buffer.from(bytes);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };

  async function zip(forced) {
    await clickText(page, 'Exporter plusieurs BSSID');
    await page.until('dialogue export', 'Boolean(document.querySelector("[role=dialog]"))');
    await clickText(page, 'Personnalisé');
    await clickText(page, 'Tous');
    if (forced) await page.evaluate('__phase6DelayFirst = true');
    try {
      const result = await download('Exporter 3 BSSID en ZIP', '.zip', expectBlock ? 16000 : 45000);
      assert.ok(!expectBlock, 'Le scénario témoin devait rester bloqué');
      const entries = unzipSync(result.bytes);
      const manifest = JSON.parse(Buffer.from(entries['manifest.json']));
      assert.equal(manifest.images.length, 3);
      assert.equal(new Set(manifest.images.map(image => image.bssid)).size, 3);
      return { ms: result.ms, bytes: result.bytes.length, images: manifest.images.map(image => pngShape(entries[image.file])) };
    } catch (error) {
      if (!(expectBlock || baseline) || !error.message.startsWith('Téléchargement bloqué')) throw error;
      assert.equal(await page.evaluate('document.querySelector("[role=dialog] button[disabled]") !== null'), true);
      await clickText(page, "Annuler l'export");
      await sleep(1000);
      const cancellationStalled = await page.evaluate('document.querySelector("[role=dialog]")?.textContent.includes("Export en cours")');
      return { blocked: true, timeoutMs: expectBlock ? 16000 : 45000, cancellationStalled };
    } finally {
      await page.evaluate('__phase6DelayFirst = false');
      if (!expectBlock) {
        await page.until('fin export ZIP', '!Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("Export en cours"))');
        await clickText(page, 'Fermer', '[role=dialog] footer button');
      }
    }
  }

  // Hold the first worker while the second can complete its export.
  await page.evaluate(`
    globalThis.__phase6DelayFirst = false;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (globalThis.__phase6DelayFirst && message?.type === 'export' && message.id === 0) {
        setTimeout(() => original.call(this, message, ...args), 6000);
      } else {
        original.call(this, message, ...args);
      }
    };
  `);
  if (expectBlock) return { forcedZip: await zip(true) };
  const result = await download('Exporter PNG', '.png');
  const png = { ms: result.ms, bytes: result.bytes.length, dimensions: pngShape(result.bytes) };
  const normal = await zip(false);
  const forcedZip = baseline ? null : await zip(true);
  const rasterLimit = await page.evaluate('Math.max(...__phase6Exports)');
  assert.equal(rasterLimit, 2048);
  return { png, zip: normal, forcedZip, rasterLimit };
}

export async function extendedChecks(reader, { child, base, mode, newPage, remoteTest, run, setRoute, overlay, wifi, networkMetrics }) {
  const writer = await newPage(mode);
  try {
    const remote = await remoteTest(reader, writer, base, mode, run);
    const samples = [];
    const takeReading = async label => {
      const browser = await reader.send('Runtime.getHeapUsage');
      const backend = await child.stats();
      const frontend = await reader.evaluate(`({
        api: __phase5cStats(), raster: __phase6Raster(),
        workers: __phase6Workers.size, visible: !document.hidden,
      })`);
      const pending = reader.requests.filter(request => !request.finished).length;
      samples.push({ label, browser, backend, frontend, pending });
    };
    await takeReading('afterRemote');
    const failures = reader.requests.length;
    const oldInstance = await fetch(child.origin() + '/api/v1/revision').then(response => response.json());
    let src = await overlay(reader, 'Plan A');
    await reader.send('Network.emulateNetworkConditions', { offline: true, ...wifi, connectionType: 'wifi' });
    let offlineRaster;
    try {
      await writer.evaluate(`__phase5c.updateBssidRule('B', {name: 'Radio B hors ligne'})`);
      await sleep(5500);
      offlineRaster = await reader.evaluate(`document.querySelector('img.leaflet-image-layer[src^="blob:"]')?.src ?? null`);
      assert.ok(offlineRaster === null || offlineRaster === src);
    } finally {
      await reader.send('Network.emulateNetworkConditions', { offline: false, ...wifi, connectionType: 'wifi' });
    }
    src = await overlay(reader, 'Plan A', src);
    // Check a second write and revision after replacing the actual Node process.
    await child.restart();
    const nextInstance = await fetch(child.origin() + '/api/v1/revision').then(response => response.json());
    assert.notEqual(nextInstance.instanceId, oldInstance.instanceId);
    await overlay(reader, 'Plan A', src);
    await takeReading('afterReconnectAndRestart');

    const routeStart = reader.requests.length;
    for (let index = 0; index < 4; index++) {
      await setRoute(reader, 'channels');
      await reader.until('canaux', "document.querySelector('h1')?.textContent.includes('Analyseur')");
      await setRoute(reader, 'heatmap');
      await overlay(reader, 'Plan A');
    }
    await setRoute(reader, 'account');
    await reader.until('libération workers', '__phase6Workers.size === 0');
    await networkMetrics(reader.requests.slice(routeStart));
    const pollReader = reader.requests.length;
    const pollWriter = writer.requests.length;
    assert.equal(await reader.evaluate('document.hidden'), false);
    assert.equal(await writer.evaluate('document.hidden'), false);
    const idleMs = Number(process.env.PHASE6_IDLE_MS ?? 65000);
    await takeReading('idleStart');
    await sleep(idleMs / 2);
    await takeReading('idleMidway');
    await sleep(idleMs / 2);
    await takeReading('idleEnd');
    const polling = await networkMetrics([...reader.requests.slice(pollReader), ...writer.requests.slice(pollWriter)]);
    assert.ok(polling.polling > 1);
    assert.equal(polling.business, 0);
    assert.equal(samples.at(-1).frontend.workers, 0);
    const campaign = reader.requests.length;
    const campaignStart = performance.now();
    for (let index = 0; index < 16; index++) {
      await writer.evaluate(`(async () => {
        const point = await __phase5c.createScanPoint('A', ${0.2 + index * 0.03}, 0.45);
        await __phase5c.saveScanAtPoint(point.id, 'A');
      })()`);
      await sleep(1500);
    }
    await setRoute(reader, 'heatmap');
    await overlay(reader, 'Plan A', '', 30);
    await takeReading('afterCampaign');
    await setRoute(reader, 'account');
    await reader.until('libération après campagne', '__phase6Workers.size === 0');
    const campaignNetwork = await networkMetrics(reader.requests.slice(campaign));
    return { remote, campaign: { scans: 16, elapsedMs: performance.now() - campaignStart, readerNetwork: campaignNetwork }, reconnectAndRestart: true, offlineRasterRetained: offlineRaster !== null, expectedNetworkFailures: reader.requests.slice(failures, routeStart).filter(request => request.status >= 400), idleMs, polling, samples };
  } finally {
    await writer.close();
  }
}
