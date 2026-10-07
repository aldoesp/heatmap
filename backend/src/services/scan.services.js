import { collectRawScan, getScanMode } from './termuxscaninfo.service.js';
import { validateRawScan } from '../validators/scan.validator.js';
import { AppError } from '../utils/AppError.js';
import { isPlaceholderBssid, measureGatewayPing } from '../utils/ping.utils.js';
import { collectConnectionInfo } from './connection.service.js';
import {
  normalizeBssid,
  frequencyToBand,
  frequencyToChannel,
  rssiToQuality,
  rssiToLevel,
  parseCapabilities,
  detectSecurity,
  detectStandard,
  isLocallyAdministered,
} from '../utils/wifi.utils.js';

export const normalizeEntry = (e) => {
  const bssid = normalizeBssid(e.bssid);
  const flags = parseCapabilities(e.capabilities);
  const ssid = (e.ssid ?? '').trim();
  const bandwidth = e.channel_bandwidth_mhz ? Number(e.channel_bandwidth_mhz) : null;

  return {
    bssid,
    ssid: ssid || null,
    hidden: ssid === '',
    band: frequencyToBand(e.frequency_mhz),
    frequency_mhz: e.frequency_mhz,
    channel: frequencyToChannel(e.frequency_mhz),
    bandwidth_mhz: bandwidth,
    center_frequency_mhz: e.center_frequency_mhz ?? null,
    center_channel: e.center_frequency_mhz ? frequencyToChannel(e.center_frequency_mhz) : null,
    rssi: e.rssi,
    quality: rssiToQuality(e.rssi),
    level: rssiToLevel(e.rssi),
    security: detectSecurity(flags),
    standard: detectStandard(flags),
    virtual_bssid: isLocallyAdministered(bssid),
    // Android masque parfois la vraie adresse (02:00:00:00:00:00) :
    // l'entrée reste exploitable mais non attribuable à une borne.
    unreliable_bssid: isPlaceholderBssid(bssid),
    // Positionné après coup via termux-wifi-connectioninfo (best-effort).
    current: false,
    capabilities: flags,
    timestamp_us: e.timestamp ?? null, // µs depuis le boot, pas une date
  };
};

const applyFilters = (list, { band, ssid, minRssi } = {}) =>
  list.filter(
    (n) =>
      (band === undefined || n.band === band) &&
      (ssid === undefined || n.ssid === ssid) &&
      (minRssi === undefined || n.rssi >= minRssi)
  );

export const getNormalizedScan = async (filters = {}) => {
  const raw = await collectRawScan();
  const { valid, rejected, fatal } = validateRawScan(raw);
  if (fatal) throw new AppError(fatal, 502);

  const normalized = valid.map(normalizeEntry).sort((a, b) => b.rssi - a.rssi);

  // Réseau connecté : le plus fort avec le même SSID (ou même BSSID),
  // comme l'upstream wifi-heatmapper. Best-effort, jamais fatal.
  let connectionWarning = null;
  try {
    const conn = await collectConnectionInfo();
    if (conn) {
      const match =
        normalized.find((n) => conn.bssid && n.bssid === conn.bssid) ??
        normalized.find((n) => conn.ssid !== '' && n.ssid === conn.ssid);
      if (match) {
        match.current = true;
        if (match.unreliable_bssid) {
          connectionWarning =
            'Android n’a pas fourni de vrai BSSID : cette mesure ne peut pas être attribuée à une borne.';
        }
      }
    }
  } catch {
    /* marquage optionnel : le scan reste valable */
  }

  const data = applyFilters(normalized, filters);
  // En test automatisé, le ping est désactivé (pas de réseau fiable) ;
  // les parseurs restent couverts par tests/ping.test.js.
  const gateway = process.env.SKIP_GATEWAY_PING
    ? {
        gatewayIp: null,
        medianRttMs: null,
        packetLossPercent: null,
        probesSent: 0,
        probesReceived: 0,
        error: 'Mesure désactivée.',
      }
    : await measureGatewayPing();

  return {
    mode: getScanMode(),
    scanned_at: new Date().toISOString(),
    count: data.length,
    rejected_count: rejected.length,
    rejected,
    data,
    gateway,
    connection_warning: connectionWarning,
  };
};