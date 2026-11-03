import { useCallback, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { LatLng } from 'leaflet';
import { buildCombinedHybridField } from './CoverageOverlay';
import { buildZoneMask, pointInPolygonPx } from '../../lib/polygon';
import { lutColourForRssi } from '../../lib/heatmapColours';
import type { InterpolationMesh } from '../../lib/triangulation';
import type { PlanPolygon } from '../../types/polygon';

interface RssiProbeLayerProps {
  meshes: InterpolationMesh[];
  polygons: PlanPolygon[];
  apPositions: readonly { bssid: string; x: number; y: number }[];
  accessPoints: readonly { id: string; x: number; y: number; bssids?: string[] }[];
  width: number;
  height: number;
  lut: Uint8ClampedArray;
  enabled: boolean;
}

export function RssiProbeLayer({
  meshes,
  polygons,
  apPositions,
  accessPoints,
  width,
  height,
  lut,
  enabled,
}: RssiProbeLayerProps) {
  const map = useMap();
  const [probe, setProbe] = useState<{ latlng: LatLng; html: string } | null>(null);
  const raf = useRef<number | null>(null);
  const pending = useRef<LatLng | null>(null);

  const fieldRef = useRef<ReturnType<typeof buildCombinedHybridField> | null>(null);
  fieldRef.current = buildCombinedHybridField(meshes, apPositions, accessPoints);
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  const lutRef = useRef(lut);
  lutRef.current = lut;

  const cancelRaf = useCallback(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    raf.current = null;
    const latlng = pending.current;
    if (!latlng) return;
    pending.current = null;

    const xPx = latlng.lng;
    const yPx = latlng.lat;
    // coords.ts: dans L.CRS.Simple, lng = xPx (plan depuis la gauche),
    // lat = yPx (plan depuis le bas). Vérifié dans lib/coords.ts.
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) {
      setProbe(null);
      return;
    }

    let zoneIndex: number | null = null;
    const polys = polygonsRef.current;
    for (let i = 0; i < polys.length; i += 1) {
      const mask = buildZoneMask(polys[i].vertices, widthRef.current, heightRef.current);
      if (!mask) continue;
      if (pointInPolygonPx(xPx, yPx, mask.pixels)) {
        zoneIndex = i + 1;
        break;
      }
    }
    if (zoneIndex === null) {
      setProbe(null);
      return;
    }

    const sample = fieldRef.current!.sample(xPx, yPx);
    if (sample.status === 'NO_DATA') {
      setProbe(null);
      return;
    }

    const colour = lutColourForRssi(lutRef.current, sample.rssi);
    const measured = sample.status === 'INTERPOLATED';
    const confidence = Math.round((sample.confidence ?? 1) * 100);
    const bssid = sample.source?.bssid ?? '—';
    const rssi = Math.round(sample.rssi);

    const html = `
      <div style="display:flex;flex-direction:column;gap:2px;align-items:flex-start;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span
            style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgb(${colour[0]},${colour[1]},${colour[2]});opacity:${colour[3] / 255};"
            aria-hidden
          />
          <span style="font-weight:600;">${rssi} dBm</span>
        </div>
        <div>Zone ${zoneIndex} · ${measured ? 'mesuré' : `estimé (confiance ${confidence} %)`}</div>
        <div style="font-size:10px;opacity:0.7;">${bssid}</div>
      </div>
    `;
    setProbe({ latlng, html });
  }, []);

  useMapEvents({
    mousemove: (event) => {
      if (!enabled) return;
      pending.current = event.latlng;
      if (raf.current === null) {
        raf.current = requestAnimationFrame(flush);
      }
    },
    click: (event) => {
      if (!enabled) return;
      pending.current = event.latlng;
      flush();
    },
    mouseout: () => {
      cancelRaf();
      pending.current = null;
      setProbe(null);
    },
  });

  if (!enabled || !probe) return null;

  const point = map.latLngToContainerPoint(probe.latlng);

  return (
    <div
      style={{
        position: 'absolute',
        left: Math.round(point.x),
        top: Math.round(point.y),
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: '#0d1319',
          opacity: 0.9,
          color: '#e8eaf2',
          font: '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.10)',
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
        }}
        dangerouslySetInnerHTML={{ __html: probe.html }}
      />
    </div>
  );
}
