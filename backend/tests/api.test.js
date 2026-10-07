// Tests d'API (mode SCAN_MODE=test, base SQLite temporaire isolée).
// Ne touchent jamais à backend/data/heatmap.db : DB_PATH pointe vers /tmp.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const TMP = mkdtempSync(path.join(tmpdir(), 'heatmap-test-'));
process.env.DB_PATH = path.join(TMP, 'test.db');
process.env.SCAN_MODE = 'test';

const { default: app } = await import('../src/app.js');
const { PLANS_DIRECTORY } = await import('../src/services/plans.service.js');

let server;
let base;
const createdPlans = [];

// Petit PNG 8x8 valide généré en mémoire
function makePng(target) {
  const W = 8;
  const H = 8;
  const raw = Buffer.concat(
    Array.from({ length: H }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(W * 3, 0x99)]))
  );
  const comp = deflateSync(raw);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', comp),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(target, png);
}

const SOURCE_PNG = path.join(TMP, 'source.png');

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 : pas de corps */
  }
  return { status: res.status, json };
}

before(async () => {
  makePng(SOURCE_PNG);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Nettoyage : plans créés (lignes + fichiers), PNG source, base temporaire
  for (const id of createdPlans) {
    await fetch(`${base}/api/v1/plans/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  await new Promise((resolve) => server.close(resolve));
  const { closeDb } = await import('../src/database/db.js');
  closeDb();
  rmSync(TMP, { recursive: true, force: true });
  assert.ok(!existsSync(SOURCE_PNG), 'le PNG temporaire doit être nettoyé');
});

describe('plans', () => {
  let planId;

  it('crée un plan depuis une image', async () => {
    const buf = await import('node:fs/promises').then((fs) => fs.readFile(SOURCE_PNG));
    const form = new FormData();
    form.append('image', new Blob([buf], { type: 'image/png' }), 'salle.png');
    const res = await fetch(`${base}/api/v1/plans`, { method: 'POST', body: form });
    assert.equal(res.status, 201);
    const plan = await res.json();
    assert.ok(plan.id);
    assert.equal(plan.name, 'salle');
    assert.ok(plan.imageUrl.startsWith('/uploads/plans/'));
    planId = plan.id;
    createdPlans.push(planId);
  });

  it('lit le plan créé', async () => {
    const { status, json } = await api('GET', `/api/v1/plans/${planId}`);
    assert.equal(status, 200);
    assert.equal(json.id, planId);
  });

  it('404 sur plan inexistant', async () => {
    const { status } = await api('GET', '/api/v1/plans/plan-inexistant');
    assert.equal(status, 404);
  });

  it('renomme le plan', async () => {
    const { status, json } = await api('PATCH', `/api/v1/plans/${planId}`, { name: 'Bureau' });
    assert.equal(status, 200);
    assert.equal(json.name, 'Bureau');
  });

  it('rejette un nom de plan vide', async () => {
    const { status } = await api('PATCH', `/api/v1/plans/${planId}`, { name: '   ' });
    assert.equal(status, 400);
  });

  it('refuse un fichier non image', async () => {
    const form = new FormData();
    form.append('image', new Blob(['pas une image'], { type: 'text/plain' }), 'note.txt');
    const res = await fetch(`${base}/api/v1/plans`, { method: 'POST', body: form });
    assert.ok([400, 415].includes(res.status));
  });
});

describe('points d’accès', () => {
  let planId;
  let apId;

  before(async () => {
    const { json } = await api('GET', '/api/v1/plans');
    planId = json[0].id;
  });

  it('crée et liste un AP', async () => {
    const { status, json } = await api('POST', `/api/v1/plans/${planId}/access-points`, {
      name: 'AP-01',
      x: 0.2,
      y: 0.3,
    });
    assert.equal(status, 201);
    apId = json.id;
    const list = await api('GET', `/api/v1/plans/${planId}/access-points`);
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
  });

  it('409 sur nom dupliqué', async () => {
    const { status } = await api('POST', `/api/v1/plans/${planId}/access-points`, {
      name: 'AP-01',
      x: 0.5,
      y: 0.5,
    });
    assert.equal(status, 409);
  });

  it('400 sur coordonnées hors [0,1]', async () => {
    const { status } = await api('POST', `/api/v1/plans/${planId}/access-points`, {
      name: 'AP-02',
      x: 2,
      y: 0.5,
    });
    assert.equal(status, 400);
  });

  it('met à jour le nom et la position', async () => {
    const { status, json } = await api('PATCH', `/api/v1/plans/access-points/${apId}`, {
      name: 'AP-02',
      x: 0.4,
      y: 0.6,
    });
    assert.equal(status, 200);
    assert.equal(json.name, 'AP-02');
    assert.equal(json.x, 0.4);
  });

  it('404 sur plan inexistant', async () => {
    const { status } = await api('POST', '/api/v1/plans/plan-inexistant/access-points', {
      name: 'AP-09',
      x: 0.1,
      y: 0.1,
    });
    assert.equal(status, 404);
  });
});

describe('relevés Wi-Fi (mode test)', () => {
  let planId;
  let pointId;
  let scanId;

  before(async () => {
    const { json } = await api('GET', '/api/v1/plans');
    planId = json[0].id;
  });

  it('crée un point de scan', async () => {
    const { status, json } = await api('POST', `/api/v1/plans/${planId}/scan-points`, {
      x: 0.5,
      y: 0.5,
    });
    assert.equal(status, 201);
    pointId = json.id;
  });

  it('400 sur coordonnées invalides', async () => {
    const { status } = await api('POST', `/api/v1/plans/${planId}/scan-points`, {
      x: -1,
      y: 0.5,
    });
    assert.equal(status, 400);
  });

  it('404 sur point inexistant au scan', async () => {
    const res = await fetch(`${base}/api/v1/scan/scan-points/point-inexistant/scans`, {
      method: 'POST',
    });
    assert.equal(res.status, 404);
  });

  it('enregistre un scan avec observations (fixture)', async () => {
    const res = await fetch(`${base}/api/v1/scan/scan-points/${pointId}/scans`, {
      method: 'POST',
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.mode, 'test');
    assert.ok(body.count > 0);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data[0].bssid);
    assert.ok(Number.isInteger(body.data[0].rssi));
    scanId = body.scan_id;
  });

  it('relit le scan et ses observations', async () => {
    const { status, json } = await api('GET', `/api/v1/scan/scans/${scanId}`);
    assert.equal(status, 200);
    assert.ok(json.observations.length > 0);
  });

  it('expose l’historique du plan', async () => {
    const { status, json } = await api('GET', `/api/v1/plans/${planId}/history`);
    assert.equal(status, 200);
    assert.equal(json.length, 1);
    assert.equal(json[0].scans.length, 1);
    assert.ok(json[0].scans[0].network_count > 0);
  });

  it('expose les données heatmap et les réseaux', async () => {
    const hm = await api('GET', `/api/v1/plans/${planId}/heatmap`);
    assert.equal(hm.status, 200);
    assert.ok(hm.json.length > 0);
    assert.ok('rssi' in hm.json[0]);

    const nets = await api('GET', `/api/v1/plans/${planId}/networks`);
    assert.equal(nets.status, 200);
    assert.ok(nets.json.length > 0);
  });
});

describe('suppressions', () => {
  it('supprime un point de scan puis le plan et son fichier', async () => {
    const { json: plans } = await api('GET', '/api/v1/plans');
    const planId = plans[0].id;
    const { json: points } = await api('GET', `/api/v1/plans/${planId}/scan-points`);
    const del = await api('DELETE', `/api/v1/plans/${planId}/scan-points/${points[0].id}`);
    assert.equal(del.status, 204);

    const { json: plan } = await api('GET', `/api/v1/plans/${planId}`);
    const storedFile = plan.imageUrl.split('/').pop();
    const res = await fetch(`${base}/api/v1/plans/${planId}`, { method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.ok(!existsSync(path.join(PLANS_DIRECTORY, storedFile)), 'le fichier image doit être supprimé');
    createdPlans.splice(createdPlans.indexOf(planId), 1);

    const gone = await api('GET', `/api/v1/plans/${planId}`);
    assert.equal(gone.status, 404);
  });
});
