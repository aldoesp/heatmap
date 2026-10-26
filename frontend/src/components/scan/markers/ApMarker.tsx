import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Wifi } from 'lucide-react';
import type { AccessPoint } from '../../../types/project';

function apIcon(ap: AccessPoint) {
  const html = renderToString(
    <div className="marker-ap">
      <Wifi size={12} strokeWidth={2.2} />
      <span className="marker-ap__label">{ap.name}</span>
    </div>
  );
  return L.divIcon({
    className: '',
    html,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

interface ApMarkerProps {
  ap: AccessPoint;
  position: [number, number];
}

export function ApMarker({ ap, position }: ApMarkerProps) {
  return (
    <Marker
      position={position}
      icon={apIcon(ap)}
      interactive={false}
      keyboard={false}
    />
  );
}