import { getNormalizedScan } from '../services/scan.services.js';
import {
  getScanMode,
  getTestScanData as loadTestScanData,
} from '../services/termuxscaninfo.service.js';

export const getScan = async (req, res) => {
  const result = await getNormalizedScan(req.filters);

  if (getScanMode() === 'test') {
    console.log(`\n[TEST] ${result.count} réseaux normalisés (${result.rejected_count} rejetés)`);
    console.table(
      result.data.map(({ bssid, ssid, band, channel, bandwidth_mhz, rssi, quality, security, standard }) => ({
        bssid, ssid, band, channel, bandwidth_mhz, rssi, quality, security, standard,
      }))
    );
    console.dir(result.data[0], { depth: null });
  }

  res.json(result);
};

export const getTestScanData = async (_req, res) => {
  res.json(await loadTestScanData());
};