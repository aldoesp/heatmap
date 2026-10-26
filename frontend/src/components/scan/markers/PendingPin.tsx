import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';

const ICON_HTML = renderToString(
  <div className="marker-target" aria-hidden="true">
    <span className="marker-target__ring" />
    <span className="marker-target__dot" />
  </div>
);

const pendingPinIcon = L.divIcon({
  className: '',
  html: ICON_HTML,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
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