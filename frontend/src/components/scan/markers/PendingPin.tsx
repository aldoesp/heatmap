import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { Wifi } from 'lucide-react';
import { renderToString } from 'react-dom/server';

const ICON_HTML = renderToString(
  <div className="marker-pin">
    <Wifi size={18} strokeWidth={2} />
  </div>
);

const pendingPinIcon = L.divIcon({
  className: '',
  html: ICON_HTML,
  iconSize: [40, 40],
  iconAnchor: [20, 40],
});

interface PendingPinProps {
  position: [number, number];
  onDragEnd: (latlng: L.LatLng) => void;
}

export function PendingPin({ position, onDragEnd }: PendingPinProps) {
  return (
    <Marker
      position={position}
      icon={pendingPinIcon}
      draggable
      autoPan
      keyboard={false}
      eventHandlers={{
        dragend: (e) => {
          const marker = e.target as L.Marker;
          onDragEnd(marker.getLatLng());
        },
      }}
    />
  );
}