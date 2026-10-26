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

const Database = (await import('better-sqlite3')).default;
const legacyDb = new Database(process.env.DB_PATH);
legacyDb.exec(`
  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    stored_file TEXT NOT NULL,
    image_url TEXT NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE scan_points (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE access_points (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(plan_id, name)
  );
`);
legacyDb.prepare(
  `INSERT INTO plans
   (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  'legacy-plan', 'Ancien plan', 'ancien.png', 'ancien.png', '/uploads/plans/ancien.png',
  'image/png', 8, 8, 100, '2020-01-01 00:00:00', '2020-01-01 00:00:00'
);
legacyDb.prepare(
  'INSERT INTO scan_points (id, plan_id, x, y) VALUES (?, ?, ?, ?)'
).run('legacy-point', 'legacy-plan', 0.2, 0.4);
legacyDb.prepare(
  'INSERT INTO access_points (id, plan_id, name, x, y) VALUES (?, ?, ?, ?, ?)'
).run('legacy-ap', 'legacy-plan', 'Ancienne borne', 0.3, 0.4);
legacyDb.close();

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

describe('migration des surveys existants', () => {
  it('regroupe l’historique d’un plan existant dans une campagne initiale', async () => {
    const surveys = await api('GET', '/api/v1/plans/legacy-plan/surveys');
    assert.equal(surveys.status, 200);
    assert.equal(surveys.json.length, 1);
    assert.equal(surveys.json[0].name, 'Ancien plan');

    const history = await api('GET', `/api/v1/surveys/${surveys.json[0].id}/history`);
    assert.equal(history.status, 200);
    assert.equal(history.json.length, 1);
    assert.equal(history.json[0].id, 'legacy-point');
    assert.equal(history.json[0].survey_id, surveys.json[0].id);
  });

  it('inverse Y des points existants sans changer leur position sur le plan', async () => {
    const scanPoints = await api('GET', '/api/v1/plans/legacy-plan/scan-points');
    assert.equal(scanPoints.status, 200);
    assert.equal(scanPoints.json[0].y, 0.6);

    const accessPoints = await api('GET', '/api/v1/plans/legacy-plan/access-points');
    assert.equal(accessPoints.status, 200);
    assert.equal(accessPoints.json[0].y, 0.6);
  });
});

describe('surveys', () => {
  let planId;
  let surveyId;
  let pointId;
  let otherSurveyId;

  before(async () => {
    const { json } = await api('GET', '/api/v1/plans');
    planId = json[0].id;
  });

  it('crée un survey explicitement sous un plan', async () => {
    const created = await api('POST', `/api/v1/plans/${planId}/surveys`, {
      name: 'Campagne initiale',
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.plan_id, planId);
    assert.equal(created.json.name, 'Campagne initiale');
    surveyId = created.json.id;

    const list = await api('GET', `/api/v1/plans/${planId}/surveys`);
    assert.equal(list.status, 200);
    assert.ok(list.json.some((survey) => survey.id === surveyId));
  });

  it('valide la création du survey et le plan parent', async () => {
    const noName = await api('POST', `/api/v1/plans/${planId}/surveys`, { name: '  ' });
    assert.equal(noName.status, 400);
    const missingPlan = await api('POST', '/api/v1/plans/inexistant/surveys', { name: 'X' });
    assert.equal(missingPlan.status, 404);
  });

  it('stocke les points et expose seulement les résultats de ce survey', async () => {
    const created = await api('POST', `/api/v1/surveys/${surveyId}/scan-points`, {
      x: 0.25,
      y: 0.75,
    });
    assert.equal(created.status, 201);
    pointId = created.json.id;
    assert.equal(created.json.survey_id, surveyId);

    const scan = await fetch(`${base}/api/v1/scan/scan-points/${pointId}/scans`, {
      method: 'POST',
    });
    assert.equal(scan.status, 201);

    const history = await api('GET', `/api/v1/surveys/${surveyId}/history`);
    assert.equal(history.status, 200);
    assert.equal(history.json.length, 1);
    assert.ok(history.json[0].scans[0].network_count > 0);

    const heatmap = await api('GET', `/api/v1/surveys/${surveyId}/heatmap`);
    assert.equal(heatmap.status, 200);
    assert.ok(heatmap.json.length > 0);

    const list = await api('GET', `/api/v1/surveys/${surveyId}/scan-points`);
    assert.equal(list.status, 200);
    assert.equal(list.json[0].id, pointId);

    const liveAnalysis = await api('GET', `/api/v1/surveys/${surveyId}/analysis/live`);
    assert.equal(liveAnalysis.status, 200);
    assert.equal(liveAnalysis.json.survey_id, surveyId);
    assert.ok(Array.isArray(liveAnalysis.json.data));

    const analysisHistory = await api('GET', `/api/v1/surveys/${surveyId}/analysis/history`);
    assert.equal(analysisHistory.status, 200);
    assert.equal(analysisHistory.json.survey_id, surveyId);
    assert.equal(analysisHistory.json.count, analysisHistory.json.data.length);
    assert.ok(analysisHistory.json.data.some((measurement) =>
      measurement.scan_point_id === pointId &&
      measurement.x === 0.25 &&
      measurement.y === 0.75 &&
      Number.isInteger(measurement.rssi) &&
      Number.isInteger(measurement.channel)
    ));

    const other = await api('POST', `/api/v1/plans/${planId}/surveys`, {
      name: 'Campagne indépendante',
    });
    otherSurveyId = other.json.id;
    const isolated = await api('GET', `/api/v1/surveys/${otherSurveyId}/history`);
    assert.deepEqual(isolated.json, []);

    const emptyAnalysis = await api('GET', `/api/v1/surveys/${otherSurveyId}/analysis/history`);
    assert.equal(emptyAnalysis.status, 200);
    assert.deepEqual(emptyAnalysis.json.data, []);
  });

  it('retourne 404 pour une analyse sans survey', async () => {
    const live = await api('GET', '/api/v1/surveys/survey-inexistant/analysis/live');
    const history = await api('GET', '/api/v1/surveys/survey-inexistant/analysis/history');
    assert.equal(live.status, 404);
    assert.equal(history.status, 404);
  });

  it('renomme et supprime la campagne avec ses points et résultats', async () => {
    const renamed = await api('PATCH', `/api/v1/surveys/${surveyId}`, {
      name: 'Campagne renommée',
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.name, 'Campagne renommée');

    const removed = await api('DELETE', `/api/v1/surveys/${surveyId}`);
    assert.equal(removed.status, 204);
    const missing = await api('GET', `/api/v1/surveys/${surveyId}/history`);
    assert.equal(missing.status, 404);

    const pointScan = await fetch(`${base}/api/v1/scan/scan-points/${pointId}/scans`, {
      method: 'POST',
    });
    assert.equal(pointScan.status, 404);
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
    assert.equal(hm.json[0].plan_id, planId);
    assert.ok(['2.4GHz', '5GHz', '6GHz'].includes(hm.json[0].band));
    assert.ok(Number.isInteger(hm.json[0].frequency_mhz));
    assert.ok('survey_id' in hm.json[0]);

    const nets = await api('GET', `/api/v1/plans/${planId}/networks`);
    assert.equal(nets.status, 200);
    assert.ok(nets.json.length > 0);
  });

  it('expose les métriques de passerelle par point (heatmap-gateway)', async () => {
    const gw = await api('GET', `/api/v1/plans/${planId}/heatmap-gateway`);
    assert.equal(gw.status, 200);
    assert.ok(Array.isArray(gw.json));
    // Une ligne par point de scan mesuré (une seule valeur par point).
    const points = gw.json.map((r) => r.scan_point_id);
    assert.equal(new Set(points).size, points.length);
    for (const row of gw.json) {
      assert.ok('gateway_rtt_ms' in row);
      assert.ok('gateway_jitter_ms' in row);
      assert.ok('gateway_loss_percent' in row);
      assert.ok(typeof row.x === 'number' && typeof row.y === 'number');
    }
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

  it('nomme globalement un BSSID et exclut les BSSID en liste noire des scans', async () => {
    const bssid = '8c:30:66:74:50:83';
    const created = await api('POST', '/api/v1/bssid-rules', {
      bssid,
      name: 'CH 209',
      blacklisted: false,
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.name, 'CH 209');
    assert.equal(created.json.blacklisted, false);

    const scan = await api('GET', '/api/v1/scan');
    assert.equal(scan.status, 200);
    assert.equal(scan.json.data.find((entry) => entry.bssid === bssid)?.bssid_name, 'CH 209');

    const blocked = await api('PATCH', `/api/v1/bssid-rules/${created.json.id}`, {
      blacklisted: true,
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.json.blacklisted, true);

    const filteredScan = await api('GET', '/api/v1/scan');
    assert.equal(filteredScan.status, 200);
    assert.ok(!filteredScan.json.data.some((entry) => entry.bssid === bssid));

    const deleted = await api('DELETE', `/api/v1/bssid-rules/${created.json.id}`);
    assert.equal(deleted.status, 204);
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
  it('filtre la heatmap par bande (2.4 / 5 / 6 GHz)', async () => {
    const all = await api('GET', `/api/v1/plans/${planId}/heatmap`);
    assert.equal(all.status, 200);
    const b5 = await api('GET', `/api/v1/plans/${planId}/heatmap?band=5`);
    assert.equal(b5.status, 200);
    const b24 = await api('GET', `/api/v1/plans/${planId}/heatmap?band=2.4`);
    assert.equal(b24.status, 200);
    const b6 = await api('GET', `/api/v1/plans/${planId}/heatmap?band=6`);
    assert.equal(b6.status, 200);
    // La fixture ne contient que du 2.4 et du 5 GHz : les deux bandes
    // doivent reconstituer l'ensemble, et le 6 GHz reste vide.
    assert.ok(b5.json.length > 0);
    assert.ok(b24.json.length > 0);
    assert.deepEqual(b6.json, []);
    assert.equal(all.json.length, b5.json.length + b24.json.length);
    const bad = await api('GET', `/api/v1/plans/${planId}/heatmap?band=7`);
    assert.equal(bad.status, 400);
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

/* ==========================================================================
   MVP simulation : calibration du plan + scénarios de simulation.
   Ces tests doivent impérativement rester exécutés APRÈS les précédents
   (ordres de déclaration du fichier), car ils créent leurs propres plans.
   ========================================================================== */

async function createTestPlan(fileName) {
  const fs = await import('node:fs/promises');
  const buf = await fs.readFile(SOURCE_PNG);
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), fileName);
  const res = await fetch(`${base}/api/v1/plans`, { method: 'POST', body: form });
  assert.equal(res.status, 201);
  const json = await res.json();
  createdPlans.push(json.id);
  return json.id;
}

const SIM_RADIO = {
  frequencyMHz: 2400,
  txPowerDbm: 20,
  antennaId: 'isotropic',
  apRotationDeg: 0,
  apHeightM: 2.5,
  rxHeightM: 1,
  rxGainDbi: 0,
  model: 'fspl',
  pathLossExponent: 2,
  referenceDistanceM: 1,
  minDistanceM: 0.1,
};

describe('calibration du plan (metersPerPixel)', () => {
  let planId;

  before(async () => {
    planId = await createTestPlan('calibration.png');
  });

  it('renvoie metersPerPixel = null sur un plan non calibré', async () => {
    const { status, json } = await api('GET', `/api/v1/plans/${planId}`);
    assert.equal(status, 200);
    assert.equal(json.metersPerPixel, null);
  });

  it('enregistre une échelle valide et la relit', async () => {
    const patched = await api('PATCH', `/api/v1/plans/${planId}/calibration`, {
      metersPerPixel: 0.02,
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.metersPerPixel, 0.02);
    const plan = await api('GET', `/api/v1/plans/${planId}`);
    assert.equal(plan.json.metersPerPixel, 0.02);
  });

  it('accepte une chaîne numérique tolérante', async () => {
    const patched = await api('PATCH', `/api/v1/plans/${planId}/calibration`, {
      metersPerPixel: '0.005',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.metersPerPixel, 0.005);
  });

  it('rejette les calibrations invalides ou aberrantes', async () => {
    for (const value of [0, -0.1, 'abc', 100, null, '']) {
      const res = await api('PATCH', `/api/v1/plans/${planId}/calibration`, {
        metersPerPixel: value,
      });
      assert.equal(res.status, 400, `valeur ${String(value)}`);
    }
    // Absente complètement
    const missing = await api('PATCH', `/api/v1/plans/${planId}/calibration`, {});
    assert.equal(missing.status, 400);
  });

  it('404 sur plan inexistant', async () => {
    const res = await api('PATCH', '/api/v1/plans/calibration-inexistante/calibration', {
      metersPerPixel: 0.02,
    });
    assert.equal(res.status, 404);
  });
});

describe('scénarios de simulation', () => {
  let planId;
  let apId;
  let apSnapshot;
  let scenarioId;

  before(async () => {
    planId = await createTestPlan('simulation.png');
    const ap = await api('POST', `/api/v1/plans/${planId}/access-points`, {
      name: 'AP-SIM',
      x: 0.2,
      y: 0.3,
    });
    assert.equal(ap.status, 201);
    apId = ap.json.id;
    // État AVANT tout scénario : l'AP réel doit rester identique ensuite.
    apSnapshot = structuredClone((await api('GET', `/api/v1/plans/${planId}/access-points`)).json);
  });

  const assertApUnchanged = async (label) => {
    const list = (await api('GET', `/api/v1/plans/${planId}/access-points`)).json;
    assert.deepEqual(list, apSnapshot, `l'AP réel ne doit pas bouger : ${label}`);
  };

  it('400 sans AP source', async () => {
    const res = await api('POST', '/api/v1/simulation-scenarios', {
      plan_id: planId,
      radio: SIM_RADIO,
    });
    assert.equal(res.status, 400);
  });

  it('404 si le plan est inconnu ou si l’AP source ne lui appartient pas', async () => {
    const missingPlan = await api('POST', '/api/v1/simulation-scenarios', {
      plan_id: 'plan-inexistant',
      sourceAccessPointId: apId,
      radio: SIM_RADIO,
    });
    assert.equal(missingPlan.status, 404);
    const foreignAp = await api('POST', '/api/v1/simulation-scenarios', {
      plan_id: planId,
      sourceAccessPointId: 'ap-inexistant',
      radio: SIM_RADIO,
    });
    assert.equal(foreignAp.status, 404);
  });

  it('400 sur configuration radio invalide', async () => {
    const cases = [
      { ...SIM_RADIO, frequencyMHz: 700 },
      { ...SIM_RADIO, txPowerDbm: 31 },
      { ...SIM_RADIO, antennaId: 'machin' },
      { ...SIM_RADIO, pathLossExponent: 0.5 },
      { ...SIM_RADIO, referenceDistanceM: 0.05 },
      { ...SIM_RADIO, minDistanceM: 0 },
      'pas-un-objet',
      null,
    ];
    for (const radio of cases) {
      const res = await api('POST', '/api/v1/simulation-scenarios', {
        plan_id: planId,
        sourceAccessPointId: apId,
        radio,
      });
      assert.equal(res.status, 400, `radio ${JSON.stringify(radio)}`);
    }
  });

  it('crée une copie sur la position de l’AP source (initial = current)', async () => {
    const res = await api('POST', '/api/v1/simulation-scenarios', {
      plan_id: planId,
      sourceAccessPointId: apId,
      name: 'Copie A',
      radio: SIM_RADIO,
    });
    assert.equal(res.status, 201);
    const scenario = res.json;
    scenarioId = scenario.id;
    assert.deepEqual(scenario.initial, { x: 0.2, y: 0.3 });
    assert.deepEqual(scenario.current, { x: 0.2, y: 0.3 });
    assert.equal(scenario.source_access_point_id, apId);
    assert.equal(scenario.name, 'Copie A');
    assert.deepEqual(scenario.radio, SIM_RADIO);
    assert.deepEqual(scenario.initialRadio, SIM_RADIO);
  });

  it('déplace la copie sans toucher à l’AP réel', async () => {
    const patched = await api('PATCH', `/api/v1/simulation-scenarios/${scenarioId}`, {
      currentX: 0.6,
      currentY: 0.7,
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.json.current, { x: 0.6, y: 0.7 });
    assert.deepEqual(patched.json.initial, { x: 0.2, y: 0.3 }, 'initial inchangé');
    await assertApUnchanged('après déplacement de la copie');
  });

  it('change la radio courante sans toucher à la radio initiale', async () => {
    const radio = { ...SIM_RADIO, txPowerDbm: 14, model: 'log-distance', pathLossExponent: 3 };
    const patched = await api('PATCH', `/api/v1/simulation-scenarios/${scenarioId}`, { radio });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.radio.txPowerDbm, 14);
    assert.equal(patched.json.radio.pathLossExponent, 3);
    assert.equal(patched.json.initialRadio.txPowerDbm, 20, 'radio initiale inchangée');
    await assertApUnchanged('après changement de radio');
  });

  it('renomme le scénario', async () => {
    const patched = await api('PATCH', `/api/v1/simulation-scenarios/${scenarioId}`, {
      name: 'Position B',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.name, 'Position B');
  });

  it('400 sur PATCH vide ou coordonnée hors bornes', async () => {
    const empty = await api('PATCH', `/api/v1/simulation-scenarios/${scenarioId}`, {});
    assert.equal(empty.status, 400);
    const out = await api('PATCH', `/api/v1/simulation-scenarios/${scenarioId}`, {
      currentX: 2,
    });
    assert.equal(out.status, 400);
  });

  it('404 sur scénario inconnu (lecture, patch, reset, suppression)', async () => {
    assert.equal((await api('GET', '/api/v1/simulation-scenarios/scenario-inconnu')).status, 404);
    assert.equal(
      (await api('PATCH', '/api/v1/simulation-scenarios/scenario-inconnu', { currentX: 0.5 })).status,
      404
    );
    assert.equal((await api('POST', '/api/v1/simulation-scenarios/scenario-inconnu/reset')).status, 404);
    assert.equal((await api('DELETE', '/api/v1/simulation-scenarios/scenario-inconnu')).status, 404);
  });

  it('réinitialise le scénario sur sa configuration initiale', async () => {
    const reset = await api('POST', `/api/v1/simulation-scenarios/${scenarioId}/reset`);
    assert.equal(reset.status, 200);
    assert.deepEqual(reset.json.current, { x: 0.2, y: 0.3 });
    assert.equal(reset.json.radio.txPowerDbm, 20, 'radio restaurée sur initialRadio');
    assert.equal(reset.json.radio.model, 'fspl');
    await assertApUnchanged('après réinitialisation');
  });

  it('liste les scénarios du plan', async () => {
    const list = await api('GET', `/api/v1/simulation-scenarios?plan_id=${planId}`);
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].id, scenarioId);
    const noPlan = await api('GET', '/api/v1/simulation-scenarios');
    assert.equal(noPlan.status, 400);
    const unknown = await api('GET', '/api/v1/simulation-scenarios?plan_id=inexistant');
    assert.equal(unknown.status, 404);
  });

  it('supprime le scénario et laisse l’AP réel intact', async () => {
    const del = await api('DELETE', `/api/v1/simulation-scenarios/${scenarioId}`);
    assert.equal(del.status, 204);
    const list = (await api('GET', `/api/v1/simulation-scenarios?plan_id=${planId}`)).json;
    assert.equal(list.length, 0);
    await assertApUnchanged('après suppression du scénario');
  });
});
