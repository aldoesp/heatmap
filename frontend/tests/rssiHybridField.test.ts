import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHybridField } from '../src/lib/rssiHybridField.js';
import { triangulateRssi } from '../src/lib/triangulation.js';
import type { GeometryPoint } from '../src/lib/triangulation.js';
import type { ApPosition } from '../src/lib/pathLossModel.js';

describe('rssiHybridField', () => {
  const ap: ApPosition = { xPx: 0, yPx: 0 };
  const points: GeometryPoint[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x = i * 20 + 10;
      const y = j * 20 + 10;
      const d = Math.hypot(x, y);
      points.push({ sourceId: `${i}-${j}`, xPx: x, yPx: y, rssi: Math.round(-30 - 30 * Math.log10(d)) });
    }
  }
  const res = triangulateRssi({ scope: { planId: 'p', surveyId: null, bssid: 'aa:bb:cc:dd:ee:01', frequency_mhz: null, band: '2.4GHz' }, plan: { id: 'p', width: 100, height: 100 }, measurements: points.map((pt) => ({ scan_point_id: pt.sourceId, planId: 'p', surveyId: null, bssid: 'aa:bb:cc:dd:ee:01', frequency_mhz: null, band: '2.4GHz', x: pt.xPx / 100, y: pt.yPx / 100, rssi: pt.rssi })) });
  const mesh = res.status === 'READY' ? res.mesh : null!;

  it('measured point rssi close', () => {
    const f = createHybridField(mesh, { ap });
    const s = f.sample(10, 10); 
    assert.equal(s.status, 'INTERPOLATED');
    if (s.status === 'INTERPOLATED') assert.ok(Math.abs(s.rssi - Math.round(-30 - 30 * Math.log10(Math.hypot(10,10)))) < 0.01);
  });
  it('far point extrapolated', () => {
    const f = createHybridField(mesh, { ap });
    const s = f.sample(500, 0);
    assert.equal(s.status, 'EXTRAPOLATED');
    if (s.status === 'EXTRAPOLATED') assert.ok(s.confidence < 0.1);
  });
  it('no ap behaves like mesh', () => {
    const f = createHybridField(mesh, { ap: null });
    const s = f.sample(500, 0);
    assert.equal(s.status, 'NO_DATA');
  });
  it('rssi in range', () => {
    const f = createHybridField(mesh, { ap });
    for (let x = 0; x <= 100; x += 10) {
      const s = f.sample(x, 0);
      if (s.rssi !== null) {
        assert.ok(s.rssi >= -127 && s.rssi <= 0);
      }
    }
  });
  it('deterministic', () => {
    const f = createHybridField(mesh, { ap });
    const a = f.sample(25, 5);
    const b = f.sample(25, 5);
    assert.deepEqual(a, b);
  });
  it('non-finite -> NO_DATA', () => {
    const f = createHybridField(mesh, { ap });
    assert.equal(f.sample(NaN, 0).status, 'NO_DATA');
  });
});
