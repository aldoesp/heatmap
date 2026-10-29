import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';

interface ApPosition {
  bssid: string;
  x: number;
  y: number;
}

interface ApMarkersLayerProps {
  positions: ApPosition[];
  width: number;
  height: number;
  draggable?: boolean;
  onDragEnd?: (bssid: string, latlng: L.LatLng) => void;
}

function apIcon() {
  const html = renderToString(<div className="marker-ap" />);
  return L.divIcon({
    className: '',
    html,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function ApMarkersLayer({
  positions,
  width,
  height,
  draggable = false,
  onDragEnd,
}: ApMarkersLayerProps) {
  const icon = apIcon();
  return (
    <>
      {positions.map((ap) => (
        <Marker
          key={ap.bssid}
          position={[ap.y * height, ap.x * width]}
          icon={icon}
          title={ap.bssid}
          draggable={draggable}
          autoPan={draggable}
          bubblingMouseEvents={false}
          keyboard={false}
          eventHandlers={
            onDragEnd
              ? {
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    onDragEnd(ap.bssid, marker.getLatLng());
                  },
                }
              : undefined
          }
        />
      ))}
    </>
  );
}
