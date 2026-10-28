import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitPathLossModel, predictPathLossRaw, computeResiduals, clampRssi, type ApPosition } from '../src/lib/pathLossModel.js';
import type { GeometryPoint } from '../src/lib/triangulation.js';

describe('pathLossModel', () => {
  it('fits n=3 synthetic', () => {
    const ap: ApPosition = { xPx: 0, yPx: 0 };
    const points: GeometryPoint[] = [];
    for (let i = 1; i <= 10; i++) {
      const d = i * 10;
      points.push({ sourceId: String(i), xPx: d, yPx: 0, rssi: -30 - 30 * Math.log10(d) });
    }
    const m = fitPathLossModel(points, ap, { width: 100, height: 100 });
    assert.ok(m);
    assert.ok(Math.abs(m!.n - 3) < 1e-6);
    assert.ok(m!.rmse < 1e-9);
  });
  it('default for <5 points', () => {
    const ap: ApPosition = { xPx: 0, yPx: 0 };
    const points: GeometryPoint[] = [
      { sourceId: '1', xPx: 10, yPx: 0, rssi: -40 },
      { sourceId: '2', xPx: 20, yPx: 0, rssi: -50 },
    ];
    const m = fitPathLossModel(points, ap, { width: 100, height: 100 });
    assert.equal(m!.nSource, 'default');
    assert.equal(m!.n, 3.0);
  });
  it('clamped when n<1.5', () => {
    const ap: ApPosition = { xPx: 0, yPx: 0 };
    // rssi constant -> slope ~0 -> n~0 -> clamped
    const points: GeometryPoint[] = [];
    for (let i = 1; i <= 8; i++) {
      points.push({ sourceId: String(i), xPx: i * 10, yPx: 0, rssi: -50 });
    }
    const m = fitPathLossModel(points, ap, { width: 100, height: 100 });
    assert.equal(m!.nSource, 'clamped');
    assert.equal(m!.n, 1.5);
  });
  it('ap on point no NaN', () => {
    const ap: ApPosition = { xPx: 5, yPx: 5 };
    const points: GeometryPoint[] = [
      { sourceId: '1', xPx: 5, yPx: 5, rssi: -40 },
      { sourceId: '2', xPx: 10, yPx: 5, rssi: -50 },
      { sourceId: '3', xPx: 15, yPx: 5, rssi: -55 },
      { sourceId: '4', xPx: 20, yPx: 5, rssi: -60 },
      { sourceId: '5', xPx: 25, yPx: 5, rssi: -65 },
    ];
    const m = fitPathLossModel(points, ap, { width: 100, height: 100 });
    assert.ok(m);
    assert.ok(Number.isFinite(m!.aDbm));
    assert.ok(Number.isFinite(m!.n));
    assert.ok(Number.isFinite(m!.rmse));
  });
  it('residuals recover rssi', () => {
    const ap: ApPosition = { xPx: 0, yPx: 0 };
    const points: GeometryPoint[] = [];
    for (let i = 1; i <= 6; i++) {
      const d = i * 10;
      points.push({ sourceId: String(i), xPx: d, yPx: 0, rssi: -30 - 30 * Math.log10(d) });
    }
    const m = fitPathLossModel(points, ap, { width: 100, height: 100 })!;
    const res = computeResiduals(points, m);
    for (const p of points) {
      const pred = predictPathLossRaw(m, p.xPx, p.yPx);
      assert.ok(Math.abs((res.get(p.sourceId)! + pred) - p.rssi) < 1e-9);
    }
  });
  it('clampRssi', () => {
    assert.equal(clampRssi(10), 0);
    assert.equal(clampRssi(-200), -127);
    assert.equal(clampRssi(-50), -50);
  });
  it('null cases', () => {
    assert.equal(fitPathLossModel([], { xPx: 0, yPx: 0 }, { width: 10, height: 10 }), null);
    assert.equal(fitPathLossModel([{ sourceId: '1', xPx: 1, yPx: 1, rssi: -40 }], { xPx: NaN, yPx: 0 }, { width: 10, height: 10 }), null);
  });
});
