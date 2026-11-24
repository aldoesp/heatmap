import { memoryCache } from './memoryCache.js';

const READ_TTL_MS = 60_000;

export function buildCacheKey(...segments) {
  return segments.map(segment => encodeURIComponent(segment)).join(':');
}

export function heatmapFilterSegment({ ssid, bssid, band, connected }) {
  // Comme en SQL, seuls les filtres texte truthy sont appliqués. Les types
  // inattendus passent par le loader, où leur comportement historique demeure.
  if ([ssid, bssid, band].some(value => value && typeof value !== 'string')) return null;
  if (!ssid && !bssid && !band && !connected) return 'all';
  return JSON.stringify([ssid || null, bssid ? bssid.toLowerCase() : null, band || null, !!connected]);
}

export function readCached(db, keySegments, loader) {
  if (process.env.BACKEND_CACHE_ENABLED !== 'true' || db.inTransaction) return loader();

  const segments = keySegments();
  if (segments.some(segment => typeof segment !== 'string')) return loader();
  let key;
  try {
    key = buildCacheKey(...segments);
  } catch (error) {
    if (error instanceof URIError) return loader();
    throw error;
  }
  return memoryCache.getOrSet(key, READ_TTL_MS, loader);
}
