import { Router } from 'express';
import { getScan, getTestScanData, saveScanAtPoint, getScanDetail } from '../controllers/scan.controller.js';
import { validateScanRequest } from '../middleware/validate.js';

const router = Router();

router.get('/test-data', getTestScanData);
// Scan live sans sauvegarde (prévisualisation)
router.get('/', validateScanRequest, getScan);
// Scan + sauvegarde liée à un point : POST /api/v1/scan/scan-points/:pointId/scans
router.post('/scan-points/:pointId/scans', validateScanRequest, saveScanAtPoint);
router.get('/scans/:scanId', validateScanRequest, getScanDetail);

export default router;
