import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PngZip, crc32, crc32Stream, sanitizeZipName } from '../src/lib/exportZip.js';
import { planRegionFromBounds, planRegionToSourceRect } from '../src/lib/exportRegion.js';

test('CRC32 de référence', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
test('ZIP : entrées UTF-8, offsets, contenu et répertoire', async () => {
  const zip = new PngZip();
  await zip.add('étage.png', new Blob(['abc']));
  await zip.add('radio.png', new Blob(['defg']));
  const bytes = new Uint8Array(await zip.finish().arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  let central = view.getUint32(end + 16, true);
  for (const [name, content] of [['étage.png', 'abc'], ['radio.png', 'defg']]) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    const offset = view.getUint32(central + 42, true);
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 6, true), 0x800);
    const length = view.getUint16(offset + 26, true);
    assert.equal(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length)), name);
    assert.equal(new TextDecoder().decode(bytes.slice(offset + 30 + length, offset + 30 + length + content.length)), content);
    assert.equal(view.getUint32(offset + 14, true), crc32(new TextEncoder().encode(content)));
    central += 46 + length;
  }
  assert.equal(central, end);
});
test('ZIP refuse archive vide, doublons et chemins', async () => {
  const zip = new PngZip();
  assert.throws(() => zip.finish());
  await assert.rejects(zip.add('../a.png', new Blob([])));
  await zip.add('a.png', new Blob([]));
  await assert.rejects(zip.add('a.png', new Blob([])));
});
test('Zone visible : inversion Y, limites et raster proportionnel', () => {
  const region = planRegionFromBounds({ west: -20, east: 500, south: 100, north: 400 }, 1000, 800);
  assert.deepEqual(region, { x: 0, y: 400, width: 500, height: 300 });
  assert.deepEqual(planRegionToSourceRect(region, 1000, 800, 500, 400), { x: 0, y: 200, width: 250, height: 150 });
});

function readZipEntry(bytes: Uint8Array, name: string): { content: Uint8Array; crc: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const directoryStart = view.getUint32(end + 16, true);
  const directorySize = view.getUint32(end + 12, true);
  let cursor = directoryStart;
  const endDir = directoryStart + directorySize;
  while (cursor < endDir) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const entryName = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (entryName === name) {
      const local = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset, bytes.byteLength - localHeaderOffset);
      assert.equal(local.getUint32(0, true), 0x04034b50);
      const localNameLength = local.getUint16(26, true);
      const localExtraLength = local.getUint16(28, true);
      const crc = local.getUint32(14, true);
      const size = local.getUint32(18, true);
      const content = bytes.slice(localHeaderOffset + 30 + localNameLength + localExtraLength, localHeaderOffset + 30 + localNameLength + localExtraLength + size);
      return { content: new Uint8Array(content), crc };
    }
  }
  assert.fail(`Entrée ZIP introuvable : ${name}`);
}

test('crc32Stream vaut crc32 sur plusieurs tailles', async () => {
  for (const size of [0, 1, 100, 65535, 65536, 65537, 100000]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 37 + 11) & 0xff;
    assert.equal(await crc32Stream(new Blob([bytes])), crc32(bytes));
  }
});

test('sanitizeZipName : caractères spéciaux, noms vides, troncature', () => {
  assert.equal(sanitizeZipName('a/b\\c?.png', 50), 'a-b-c-.png');
  assert.equal(sanitizeZipName('', 50), 'fichier');
  assert.equal(sanitizeZipName('---', 50), 'fichier');
  assert.equal(sanitizeZipName('éà.png', 50), 'éà.png');
  assert.equal(sanitizeZipName('a'.repeat(100), 50).length, 50);
});

test('ZIP round-trip : contenu et CRC des entrées', async () => {
  const zip = new PngZip();
  await zip.add('a.png', new Blob([new Uint8Array([1, 2, 3])]));
  await zip.add('b.png', new Blob([new Uint8Array([...Array(100000)].map((_, i) => i & 0xff))]));
  const bytes = new Uint8Array(await zip.finish().arrayBuffer());
  const a = readZipEntry(bytes, 'a.png');
  assert.deepEqual([...a.content], [1, 2, 3]);
  assert.equal(a.crc, crc32(new Uint8Array([1, 2, 3])));
  const bContent = [...Array(100000)].map((_, i) => i & 0xff);
  const b = readZipEntry(bytes, 'b.png');
  assert.deepEqual([...b.content], bContent);
  assert.equal(b.crc, crc32(new Uint8Array(bContent)));
});

test('ZIP contient manifest.json', async () => {
  const zip = new PngZip();
  zip.addManifest({
    format: 'heatmap-zip', version: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    plan: { id: 'p1', name: 'Mon plan', width: 1000, height: 800 },
    images: [{ file: 'a.png', bssid: 'aa:bb', ssid: 'Mon SSID', band: '5', calculation: 'regularized' }],
  });
  await zip.add('a.png', new Blob([new Uint8Array([1, 2, 3])]));
  const bytes = new Uint8Array(await zip.finish().arrayBuffer());
  const entry = readZipEntry(bytes, 'manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(entry.content));
  assert.equal(manifest.format, 'heatmap-zip');
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.plan, { id: 'p1', name: 'Mon plan', width: 1000, height: 800 });
  assert.equal(manifest.images.length, 1);
  assert.equal(manifest.images[0].file, 'a.png');
  assert.equal(manifest.images[0].bssid, 'aa:bb');
  assert.equal(entry.crc, crc32(entry.content));
});
