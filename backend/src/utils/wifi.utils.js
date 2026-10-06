export const normalizeBssid = (bssid) => String(bssid).trim().toLowerCase();

export const frequencyToBand = (mhz) => {
  if (mhz >= 2400 && mhz <= 2500) return '2.4GHz';
  if (mhz >= 5150 && mhz <= 5895) return '5GHz';
  if (mhz >= 5925 && mhz <= 7125) return '6GHz';
  return 'unknown';
};

export const frequencyToChannel = (mhz) => {
  if (mhz === 2484) return 14;
  if (mhz >= 2400 && mhz <= 2500) return Math.round((mhz - 2407) / 5);
  if (mhz >= 5150 && mhz <= 5895) return Math.round((mhz - 5000) / 5);
  if (mhz >= 5925 && mhz <= 7125) return Math.round((mhz - 5950) / 5);
  return null;
};

// RSSI (dBm) -> qualité 0-100
export const rssiToQuality = (rssi) =>
  Math.max(0, Math.min(100, 2 * (rssi + 100)));

export const rssiToLevel = (rssi) => {
  if (rssi >= -55) return 'excellent';
  if (rssi >= -67) return 'good';
  if (rssi >= -75) return 'fair';
  if (rssi >= -85) return 'weak';
  return 'very_weak';
};

// "[WPA2-PSK-CCMP][ESS]" -> ['WPA2-PSK-CCMP', 'ESS']
export const parseCapabilities = (capabilities = '') =>
  [...String(capabilities).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);

export const detectSecurity = (flags) => {
  const joined = flags.join(' ');
  if (/EAP/.test(joined)) return 'ENTERPRISE';
  if (/SAE/.test(joined)) return /PSK/.test(joined) ? 'WPA2/WPA3' : 'WPA3';
  if (/WPA2|RSN/.test(joined)) return 'WPA2';
  if (/WPA/.test(joined)) return 'WPA';
  if (/WEP/.test(joined)) return 'WEP';
  return 'OPEN';
};

export const detectStandard = (flags) => {
  const joined = flags.join(' ');
  if (/HE/.test(joined)) return 'wifi6 (802.11ax)';
  if (/VHT/.test(joined)) return 'wifi5 (802.11ac)';
  if (/HT/.test(joined)) return 'wifi4 (802.11n)';
  return 'legacy';
};

// Bit "locally administered" : BSSID virtuel (multi-SSID) dérivé d'un AP physique
export const isLocallyAdministered = (bssid) =>
  (parseInt(bssid.slice(0, 2), 16) & 0b10) !== 0;