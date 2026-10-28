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

export function ApMarkersLayer({ positions, width, height }: ApMarkersLayerProps) {
  const icon = apIcon();
  return (
    <>
      {positions.map((ap) => (
        <Marker
          key={ap.bssid}
          position={[ap.y * height, ap.x * width]}
          icon={icon}
          title={ap.bssid}
        />
      ))}
    </>
  );
}
