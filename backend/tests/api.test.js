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
process.env.RATE_LIMIT_MAX = '1000';
process.env.SKIP_GATEWAY_PING = '1';

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
  it('enregistre la note du point', async () => {
    const { status, json } = await api('PATCH', `/api/v1/plans/${planId}/scan-points/${pointId}`, {
      note: 'Entrée du bureau, porte ouverte.',
    });
    assert.equal(status, 200);
    assert.equal(json.note, 'Entrée du bureau, porte ouverte.');
  });

  it('la note remonte dans l’historique', async () => {
    const { status, json } = await api('GET', `/api/v1/plans/${planId}/history`);
    assert.equal(status, 200);
    assert.equal(json[0].note, 'Entrée du bureau, porte ouverte.');
  });

  it('400 sur note vide ou trop longue', async () => {
    const empty = await api('PATCH', `/api/v1/plans/${planId}/scan-points/${pointId}`, {
      note: '   ',
    });
    assert.equal(empty.status, 400);
    const long = await api('PATCH', `/api/v1/plans/${planId}/scan-points/${pointId}`, {
      note: 'x'.repeat(501),
    });
    assert.equal(long.status, 400);
  });

  it('404 sur point inexistant pour la note', async () => {
    const { status } = await api('PATCH', `/api/v1/plans/${planId}/scan-points/point-inexistant`, {
      note: 'test',
    });
    assert.equal(status, 404);
  });
});

describe('réglages, mapping et export', () => {
  let planId;
  let pointId;

  before(async () => {
    const { json } = await api('GET', '/api/v1/plans');
    planId = json[0].id;
    const created = await api('POST', `/api/v1/plans/${planId}/scan-points`, { x: 0.3, y: 0.7 });
    pointId = created.json.id;
    await fetch(`${base}/api/v1/scan/scan-points/${pointId}/scans`, { method: 'POST' });
  });

  it('expose le statut et les réglages', async () => {
    const st = await api('GET', '/api/v1/status');
    assert.equal(st.status, 200);
    assert.equal(st.json.scan_mode, 'test');
    const se = await api('GET', '/api/v1/settings');
    assert.equal(se.status, 200);
    assert.ok('iperf_server' in se.json && 'iperf_duration_s' in se.json);
  });

  it('enregistre le serveur iperf et refuse une durée invalide', async () => {
    const ok = await api('PATCH', '/api/v1/settings', { key: 'iperf_server', value: '192.168.1.10' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.value, '192.168.1.10');
    const bad = await api('PATCH', '/api/v1/settings', { key: 'iperf_duration_s', value: '99' });
    assert.equal(bad.status, 400);
    const unknown = await api('PATCH', '/api/v1/settings', { key: 'nope', value: 'x' });
    assert.equal(unknown.status, 400);
    // Nettoyage : pas de serveur pour la suite (sinon iperf ralentit les tests)
    const reset = await api('PATCH', '/api/v1/settings', { key: 'iperf_server', value: '' });
    assert.equal(reset.status, 200);
  });

  it('nomme une borne (BSSID), 409 sur doublon, 400 sur MAC invalide', async () => {
    const created = await api('POST', `/api/v1/plans/${planId}/ap-mappings`, {
      name: 'Borne salon',
      bssid: '9e:05:d6:96:e8:30',
    });
    assert.equal(created.status, 201);
    const dup = await api('POST', `/api/v1/plans/${planId}/ap-mappings`, {
      name: 'Autre nom',
      bssid: '9E:05:D6:96:E8:30',
    });
    assert.equal(dup.status, 409);
    const bad = await api('POST', `/api/v1/plans/${planId}/ap-mappings`, {
      name: 'X',
      bssid: 'pas-une-mac',
    });
    assert.equal(bad.status, 400);
    const list = await api('GET', `/api/v1/plans/${planId}/ap-mappings`);
    assert.equal(list.json.length, 1);
    const del = await api('DELETE', `/api/v1/plans/ap-mappings/${created.json.id}`);
    assert.equal(del.status, 204);
  });

  it('coupe un point : exclu de la heatmap, visible dans le CSV', async () => {
    const off = await api('PATCH', `/api/v1/plans/${planId}/scan-points/${pointId}`, {
      is_enabled: 0,
    });
    assert.equal(off.status, 200);
    assert.equal(off.json.is_enabled, 0);
    const hm = await api('GET', `/api/v1/plans/${planId}/heatmap`);
    assert.ok(!hm.json.some((r) => r.scan_point_id === pointId));
    const csvRes = await fetch(`${base}/api/v1/plans/${planId}/export.csv`);
    assert.equal(csvRes.status, 200);
    assert.ok(String(csvRes.headers.get('content-type')).includes('text/csv'));
    const csv = await csvRes.text();
    assert.ok(csv.split('\n')[0].includes('ap_name'));
    assert.ok(csv.includes('no,') || csv.includes(',no,'));
    const on = await api('PATCH', `/api/v1/plans/${planId}/scan-points/${pointId}`, {
      is_enabled: 1,
    });
    assert.equal(on.json.is_enabled, 1);
  });
  it('filtre la heatmap sur le réseau connecté', async () => {
    const { getDb } = await import('../src/database/db.js');
    const db = getDb();
    const target = db
      .prepare(
        `SELECT o.bssid FROM observations o
         JOIN scans s ON s.id = o.scan_id
         JOIN scan_points sp ON sp.id = s.scan_point_id
         WHERE sp.plan_id = ? ORDER BY o.rssi DESC LIMIT 1`
      )
      .get(planId);
    assert.ok(target);
    db.prepare('UPDATE observations SET current = 1 WHERE bssid = ?').run(target.bssid);
    const filtered = await api('GET', `/api/v1/plans/${planId}/heatmap?connected=1`);
    assert.equal(filtered.status, 200);
    assert.ok(filtered.json.length > 0);
    assert.ok(filtered.json.every((r) => r.bssid === target.bssid));
    const all = await api('GET', `/api/v1/plans/${planId}/heatmap`);
    assert.ok(all.json.length >= filtered.json.length);
  });
  it('bascule le mode de scan et revient à SCAN_MODE', async () => {
    const live = await api('PATCH', '/api/v1/settings', { key: 'scan_mode', value: 'live' });
    assert.equal(live.status, 200);
    const stLive = await api('GET', '/api/v1/status');
    assert.equal(stLive.json.scan_mode, 'live');
    const bad = await api('PATCH', '/api/v1/settings', { key: 'scan_mode', value: 'demo' });
    assert.equal(bad.status, 400);
    const reset = await api('PATCH', '/api/v1/settings', { key: 'scan_mode', value: '' });
    assert.equal(reset.status, 200);
    const stTest = await api('GET', '/api/v1/status');
    assert.equal(stTest.json.scan_mode, 'test');
  });
});

describe('suppressions', () => {
  it('abandonne un relevé après scan (revue Garder/Supprimer)', async () => {
    const { json: plans } = await api('GET', '/api/v1/plans');
    const planId = plans[0].id;
    // Scan complet comme le ferait le dialogue de revue avant Supprimer
    const created = await api('POST', `/api/v1/plans/${planId}/scan-points`, {
      x: 0.1,
      y: 0.9,
    });
    assert.equal(created.status, 201);
    const saved = await fetch(
      `${base}/api/v1/scan/scan-points/${created.json.id}/scans`,
      { method: 'POST' }
    );
    assert.equal(saved.status, 201);
    const del = await api('DELETE', `/api/v1/plans/${planId}/scan-points/${created.json.id}`);
    assert.equal(del.status, 204);
    const { json: points } = await api('GET', `/api/v1/plans/${planId}/scan-points`);
    assert.ok(!points.some((p) => p.id === created.json.id));
  });

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
