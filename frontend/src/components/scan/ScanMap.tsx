import { useEffect, useMemo, useState } from 'react';
import { MapContainer, ImageOverlay, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { AccessPoint, ScanPoint } from '../../types/project';
import { dataToLatLng } from '../../lib/coords';
import { PendingPin } from './markers/PendingPin';
import { ScanMarker } from './markers/ScanMarker';
import { ApMarker } from './markers/ApMarker';

const NAVBAR_H = 80;

interface ScanMapProps {
  imageUrl: string;
  width: number;
  height: number;
  accessPoints: AccessPoint[];
  scanPoints: ScanPoint[];
  pendingLatLng: L.LatLng | null;
  onMapClick: (latlng: L.LatLng) => void;
  onPinDragEnd: (latlng: L.LatLng) => void;
  registerFit: (fn: () => void) => void;
}

function MapController({
  bounds,
  registerFit,
}: {
  bounds: L.LatLngBoundsExpression;
  registerFit: (fn: () => void) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      const panelTop = document.querySelector('[data-desktop-panel]')?.getBoundingClientRect().top;
      const bottomPadding = panelTop === undefined ? 160 : Math.max(24, window.innerHeight - panelTop + 12);
      map.fitBounds(bounds, {
        paddingTopLeft: [16, NAVBAR_H],
        paddingBottomRight: [16, bottomPadding],
      });
      map.setMaxBounds(bounds);
      map.setMinZoom(map.getBoundsZoom(bounds) - 1);
    };
    fit();
    registerFit(fit);

    // Sur resize (barre d'URL Android, rotation...), on ne refait QUE
    // invalidateSize : la vue/zoom de l'utilisateur est conservée.
    // Le recadrage reste un geste volontaire (bouton Recentrer, retour #/scan).
    let timer: number | null = null;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => map.invalidateSize(), 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) window.clearTimeout(timer);
    };
  }, [map, bounds, registerFit]);

  return null;
}

function ClickCatcher({ onClick }: { onClick: (latlng: L.LatLng) => void }) {
  useMapEvents({
    click: (e) => onClick(e.latlng),
  });
  return null;
}

export function ScanMap({
  imageUrl,
  width,
  height,
  accessPoints,
  scanPoints,
  pendingLatLng,
  onMapClick,
  onPinDragEnd,
  registerFit,
}: ScanMapProps) {
  const [showMeasurements, setShowMeasurements] = useState(true);

  const bounds = useMemo<L.LatLngBoundsExpression>(
    () => [
      [0, 0],
      [height, width],
    ],
    [width, height]
  );

  const pendingPosition = useMemo<[number, number] | null>(() => {
    if (!pendingLatLng) return null;
    return [pendingLatLng.lat, pendingLatLng.lng];
  }, [pendingLatLng]);

  return (
    <>
    <MapContainer
      center={[height / 2, width / 2]}
      zoom={0}
      minZoom={-5}
      maxZoom={5}
      zoomControl
      attributionControl={false}
      zoomSnap={0.25}
      zoomDelta={0.5}
      crs={L.CRS.Simple}
      className="fixed inset-0 z-0"
    >
      <MapController bounds={bounds} registerFit={registerFit} />
      <ClickCatcher onClick={onMapClick} />
      <ImageOverlay url={imageUrl} bounds={bounds} />

      {accessPoints.map((ap) => {
        const pos = dataToLatLng(ap.x, ap.y, width, height);
        return <ApMarker key={ap.id} ap={ap} position={pos} />;
      })}

      {showMeasurements && scanPoints.map((p, i) => {
        const pos = dataToLatLng(p.x, p.y, width, height);
        return <ScanMarker key={p.id} position={pos} index={i + 1} />;
      })}

      {pendingPosition && (
        <PendingPin position={pendingPosition} onDragEnd={onPinDragEnd} />
      )}
    </MapContainer>
    <button
      type="button"
      aria-pressed={showMeasurements}
      onClick={() => setShowMeasurements((visible) => !visible)}
      className="glass-fallback fixed right-3 z-[450] min-h-11 rounded-xl border border-glass-border-soft bg-[#111923]/95 px-3 text-xs font-medium text-text shadow-glass transition-colors hover:border-accent-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ top: 'calc(var(--nav-top-offset) + 105px)' }}
      title={showMeasurements ? 'Masquer les points déjà mesurés' : 'Afficher les points déjà mesurés'}
    >
      {showMeasurements ? 'Masquer points' : 'Afficher points'} · {scanPoints.length}
    </button>
    </>
  );
}
