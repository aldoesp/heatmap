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
} from '../repositories/scans.repository.js';

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
      entries: result.data,
    });

    res.status(201).json({
      scan_id: scanId,
      scan_point_id: point.id,
      plan_id: point.plan_id,
      ...result,
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
  });
};