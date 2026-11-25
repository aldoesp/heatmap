import type { HeatmapRenderInput } from '../src/lib/heatmapRender.js';
import type { RssiPolygonConstraint } from '../src/lib/heatmapRssi.js';
import { buildColourLut, DEFAULT_HEATMAP_COLOURS } from '../src/lib/heatmapColours.js';
import { RSSI_BANDS } from '../src/lib/signal.js';
import type { PlanReference } from '../src/lib/triangulation.js';
import type { HeatmapRow } from '../src/types/api.js';

// Charge déterministe utilisée par OpenCode et issue du scénario de phase 0.
const PLAN: PlanReference = { id: 'bench-plan', width: 2400, height: 1600 };
const COLS = 10;
const ROWS = 8;
const BSSID_COUNT = 10;

function macAddress(index: number): string {
  return [
    0x02,
    (index >> 16) & 0xff,
    (index >> 8) & 0xff,
    index & 0xff,
    (index * 7) & 0xff,
    (index * 13) & 0xff,
  ]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join(':');
}

const BSSIDS = Array.from({ length: BSSID_COUNT }, (_, index) => macAddress(index + 1));
const ANCHORS = Array.from({ length: 4 }, (_, index) => ({
  bssid: BSSIDS[index % BSSIDS.length],
  x: 0.15 + index * 0.2,
  y: 0.2 + (index % 2) * 0.5,
}));

function buildMeasurements(): HeatmapRow[] {
  const rows: HeatmapRow[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const pointIndex = row * COLS + col;
      const x = (col + 0.5) / COLS;
      const y = (row + 0.5) / ROWS;
      for (let bssidIndex = 0; bssidIndex < BSSID_COUNT; bssidIndex += 1) {
        const anchor = ANCHORS[bssidIndex % ANCHORS.length];
        const dx = (x - anchor.x) * PLAN.width;
        const dy = (y - anchor.y) * PLAN.height;
        const distance = Math.hypot(dx, dy);
        const rssi = Math.max(-90, Math.min(-40, Math.round(-42 - 20 * Math.log10(1 + distance / 80))));
        const band24 = bssidIndex % 5 === 0;
        rows.push({
          scan_point_id: `p-${pointIndex}`,
          plan_id: PLAN.id,
          survey_id: 'survey-bench',
          x,
          y,
          bssid: BSSIDS[bssidIndex],
          bssid_name: `AP-${bssidIndex + 1}`,
          ssid: `SSID-${(bssidIndex % 5) + 1}`,
          band: band24 ? '2.4GHz' : '5GHz',
          frequency_mhz: band24 ? 2437 : 5180 + (bssidIndex % 8) * 20,
          rssi,
          quality: Math.max(0, Math.min(100, Math.round((rssi + 100) * 2))),
        });
      }
    }
  }
  return rows;
}

const measurements = buildMeasurements();
const polygons: RssiPolygonConstraint[] = [
  {
    id: 'zone-1',
    vertices: [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ],
  },
];
const apPositions = ANCHORS;
const accessPoints = ANCHORS.map((anchor, index) => ({
  id: `ap-${index}`,
  x: anchor.x,
  y: anchor.y,
  bssids: [anchor.bssid],
}));
export const input: HeatmapRenderInput = {
  metric: 'rssi', calculation: 'regularized', plan: PLAN, measurements,
  points: [], polygons, apPositions, accessPoints, radius: 80, bands: RSSI_BANDS,
  lut: buildColourLut(DEFAULT_HEATMAP_COLOURS), showEstimated: true,
};
