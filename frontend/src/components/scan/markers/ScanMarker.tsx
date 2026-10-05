import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';

function scanIcon(n: number) {
  const html = renderToString(
    <div className="marker-scan">{String(n).padStart(2, '0')}</div>
  );
  return L.divIcon({
    className: '',
    html,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

interface ScanMarkerProps {
  position: [number, number];
  index: number;
}

export function ScanMarker({ position, index }: ScanMarkerProps) {
  return (
    <Marker
      position={position}
      icon={scanIcon(index)}
      interactive={false}
      keyboard={false}
    />
  );
}