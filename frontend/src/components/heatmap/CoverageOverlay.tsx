import { ImageOverlay } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';

/** The worker prepares the image; changing opacity never recomputes its pixels. */
export function CoverageOverlay({ imageUrl, bounds, opacity = 1 }: {
  imageUrl: string | null;
  bounds: LatLngBoundsExpression;
  opacity?: number;
}) {
  return imageUrl ? <ImageOverlay url={imageUrl} bounds={bounds} opacity={opacity} /> : null;
}

