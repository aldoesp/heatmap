const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const BANDS = ['2.4', '5', '6'];

// Valide UNE entrée brute du scan -> tableau d'erreurs (vide = valide)
export const validateRawEntry = (entry) => {
  const errors = [];
  if (!entry || typeof entry !== 'object') return ['entrée non-objet'];
  if (!BSSID_RE.test(entry.bssid ?? '')) errors.push('bssid invalide');
  if (!Number.isFinite(entry.frequency_mhz)) errors.push('frequency_mhz invalide');
  if (!Number.isFinite(entry.rssi) || entry.rssi > 0 || entry.rssi < -127)
    errors.push('rssi invalide (attendu entre -127 et 0)');
  if (entry.ssid !== undefined && typeof entry.ssid !== 'string')
    errors.push('ssid doit être une chaîne');
  return errors;
};

// Valide le scan complet : sépare entrées valides / rejetées
export const validateRawScan = (raw) => {
  if (!Array.isArray(raw)) {
    return { valid: [], rejected: [], fatal: 'La sortie du scan n’est pas un tableau' };
  }
  const valid = [];
  const rejected = [];
  raw.forEach((entry, index) => {
    const errors = validateRawEntry(entry);
    if (errors.length) rejected.push({ index, bssid: entry?.bssid ?? null, errors });
    else valid.push(entry);
  });
  return { valid, rejected, fatal: null };
};

// Query string : ?band=5&ssid=ZMTL_GUEST&minRssi=-80
export const validateScanQuery = (query) => {
  const errors = [];
  const filters = {};

  if (query.band !== undefined) {
    if (!BANDS.includes(query.band)) errors.push('band doit être 2.4, 5 ou 6');
    else filters.band = `${query.band}GHz`;
  }
  if (query.ssid !== undefined) filters.ssid = String(query.ssid);
  if (query.minRssi !== undefined) {
    const v = Number(query.minRssi);
    if (!Number.isFinite(v) || v > 0 || v < -127) errors.push('minRssi invalide');
    else filters.minRssi = v;
  }
  return { errors, filters };
};