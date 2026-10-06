import { collectRawScan, getScanMode } from './termuxscaninfo.service.js';
import { validateRawScan } from '../validators/scan.validator.js';
import { AppError } from '../utils/AppError.js';
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
  const data = applyFilters(normalized, filters);

  return {
    mode: getScanMode(),
    scanned_at: new Date().toISOString(),
    count: data.length,
    rejected_count: rejected.length,
    rejected,
    data,
  };
};