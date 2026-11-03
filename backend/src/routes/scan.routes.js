import { Router } from 'express';
import { getScan, getTestScanData, saveScanAtPoint, getScanDetail } from '../controllers/scan.controller.js';
import { validateScanRequest } from '../middleware/validate.js';
import { scanLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/test-data', getTestScanData);
// Scan live sans sauvegarde (prévisualisation)
router.get('/', scanLimiter, validateScanRequest, getScan);
// Scan + sauvegarde liée à un point : POST /api/v1/scan/scan-points/:pointId/scans
router.post('/scan-points/:pointId/scans', scanLimiter, validateScanRequest, saveScanAtPoint);
router.get('/scans/:scanId', validateScanRequest, getScanDetail);

export default router;
