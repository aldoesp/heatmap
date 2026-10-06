import { Router } from 'express';
import { getScan, getTestScanData } from '../controllers/scan.controller.js';
import { validateScanRequest } from '../middleware/validate.js';

const router = Router();

router.get('/test-data', getTestScanData);
router.get('/', validateScanRequest, getScan);

export default router;