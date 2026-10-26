import { getNormalizedScan } from '../services/scan.services.js';
import {
  getScanMode,
  getTestScanData as loadTestScanData,
} from '../services/termuxscaninfo.service.js';
import { AppError } from '../utils/AppError.js';
import { findScanPointById } from '../repositories/scanPoints.repository.js';
import {
  insertScanWithObservations,
  findScanById,
  listObservationsByScan,
  insertSpeedTest,
  findSpeedByScan,
} from '../repositories/scans.repository.js';
import { getAllSettings } from '../repositories/settings.repository.js';
import { runIperf } from '../services/iperf.service.js';

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

// POST /api/v1/scan/scan-points/:pointId/scans — lance un scan réel et le persiste
export const saveScanAtPoint = async (req, res, next) => {
  try {
    const point = findScanPointById(req.params.pointId);
    if (!point) throw new AppError('Point de scan introuvable.', 404);

    const result = await getNormalizedScan(req.filters ?? {});
    const scanId = insertScanWithObservations({
      scan_point_id: point.id,
      plan_id: point.plan_id,
      mode: result.mode,
      scanned_at: result.scanned_at,
      rejected_count: result.rejected_count,
      gateway: result.gateway,
      entries: result.data,
    });

    // Débit iperf3 (optionnel) : seulement si un serveur est configuré.
    // Best-effort : un échec ne remet jamais en cause le scan Wi-Fi.
    let speed = null;
    try {
      const settings = getAllSettings();
      if (settings.iperf_server) {
        const measured = await runIperf(
          settings.iperf_server,
          Number(settings.iperf_duration_s) || 5
        );
        speed = insertSpeedTest({
          scan_id: scanId,
          tcp_down_bps: measured.tcpDownBps,
          tcp_up_bps: measured.tcpUpBps,
          duration_s: measured.durationS,
          error: measured.error,
        });
      }
    } catch {
      /* mesure de débit optionnelle */
    }

    res.status(201).json({
      scan_id: scanId,
      scan_point_id: point.id,
      plan_id: point.plan_id,
      survey_id: point.survey_id,
      ...result,
      speed,
    });
  } catch (err) {
    next(err);
  }
};

export const getScanDetail = (req, res, next) => {
  const scan = findScanById(req.params.scanId);
  if (!scan) return next(new AppError('Scan introuvable.', 404));
  res.json({
    ...scan,
    observations: listObservationsByScan(scan.id, req.filters ?? {}),
    speed: findSpeedByScan(scan.id),
  });
};