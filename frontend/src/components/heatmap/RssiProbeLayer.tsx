import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleMarker, Tooltip, useMapEvents } from 'react-leaflet';
import type { LatLng } from 'leaflet';
import type { RssiCalculation } from '../../lib/regularizedRssi';
import { lutColourForRssi } from '../../lib/heatmapColours';
import type { HybridSample } from '../../lib/rssiHybridField';

type SampleAt = (x: number, y: number) => Promise<HybridSample>;

interface RssiProbeLayerProps {
  calculation: RssiCalculation;
  sampleAt: SampleAt;
  lut: Uint8ClampedArray;
  enabled: boolean;
  showEstimated: boolean;
}

type Probe = {
  latlng: LatLng;
  sample: Exclude<HybridSample, { status: 'NO_DATA' }>;
  sampler: SampleAt;
};

export function RssiProbeLayer({
  sampleAt, lut, enabled, showEstimated, calculation,
}: RssiProbeLayerProps) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const raf = useRef<number | null>(null);
  const pending = useRef<LatLng | null>(null);
  const requestToken = useRef(0);

  const cancelRaf = useCallback(() => {
    requestToken.current++;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    pending.current = null;
  }, []);

  const flush = useCallback(() => {
    raf.current = null;
    const latlng = pending.current;
    pending.current = null;
    if (!latlng) return;
    const token = ++requestToken.current;
    void sampleAt(latlng.lng, latlng.lat).then(sample => {
      if (token !== requestToken.current) return;
      setProbe(sample.status === 'NO_DATA' ? null : { latlng, sample, sampler: sampleAt });
    });
  }, [sampleAt]);

  // Annule aussi les callbacks capturant un ancien plan ou filtre.
  useEffect(() => cancelRaf, [cancelRaf, flush, enabled]);

  const clear = () => {
    cancelRaf();
    setProbe(null);
  };
  useMapEvents({
    mousemove(event) {
      if (!enabled) return;
      pending.current = event.latlng;
      if (raf.current === null) raf.current = requestAnimationFrame(flush);
    },
    click(event) {
      if (!enabled) return;
      cancelRaf();
      pending.current = event.latlng;
      flush();
    },
    mouseout: clear,
    movestart: clear,
    zoomstart: clear,
  });

  if (!enabled || !probe || probe.sampler !== sampleAt) return null;
  const { sample } = probe;
  if (sample.status === 'EXTRAPOLATED' && !showEstimated) return null;
  const colour = lutColourForRssi(lut, sample.rssi);
  return (
    <CircleMarker center={probe.latlng} radius={0} interactive={false}
      pathOptions={{ opacity: 0, fillOpacity: 0 }}>
      <Tooltip position={probe.latlng} permanent direction="top" opacity={0.95}>
        <div className="flex flex-col gap-0.5 font-mono">
          <strong className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})` }} aria-hidden />
            {Math.round(sample.rssi)} dBm
          </strong>
          <span>{sample.status === 'INTERPOLATED'
            ? calculation === 'regularized' ? 'Estimation régularisée · zone maillée' : 'Interpolé entre les mesures'
            : calculation === 'regularized' ? 'Extrapolation · appui spatial limité' : `Estimé · indice de confiance ${Math.round(sample.confidence * 100)} %`}</span>
          <span className="text-[10px] opacity-70">{sample.source?.bssid ?? '—'}</span>
        </div>
      </Tooltip>
    </CircleMarker>
  );
}

