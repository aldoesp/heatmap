import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import {
  ensurePlansDirectory,
  getPlanExtension,
  PLANS_DIRECTORY,
} from '../services/plans.service.js';
import {
  createPlan,
  getPlans,
  getPlan,
  patchPlan,
  removePlan,
  createAccessPoint,
  getAccessPoints,
  removeAccessPoint,
  patchAccessPoint,
  createScanPoint,
  getScanPoints,
  removeScanPoint,
  patchScanPoint,
  getHeatmap,
  getHeatmapSpeed,
  getHistory,
  getNetworks,
  exportCsv,
  getMappings,
  createMapping,
  removeMapping,
} from '../controllers/plans.controller.js';

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    ensurePlansDirectory().then(
      () => callback(null, PLANS_DIRECTORY),
      callback
    );
  },
  filename: (_req, file, callback) => {
    const extension = getPlanExtension(file.mimetype);
    callback(null, `${randomUUID()}.${extension ?? 'upload'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!getPlanExtension(file.mimetype)) {
      callback(new AppError('Format non supporté. Utilise JPG, PNG ou WebP.', 415));
      return;
    }
    callback(null, true);
  },
});

const router = Router();

router.get('/', getPlans);
router.post('/', upload.single('image'), createPlan);
router.get('/:id', getPlan);
router.patch('/:id', patchPlan);
router.delete('/:id', removePlan);

router.get('/:id/access-points', getAccessPoints);
router.post('/:id/access-points', createAccessPoint);

router.get('/:id/scan-points', getScanPoints);
router.post('/:id/scan-points', createScanPoint);
router.delete('/:id/scan-points/:pointId', removeScanPoint);
router.patch('/:id/scan-points/:pointId', patchScanPoint);

router.get('/:id/heatmap', getHeatmap);
router.get('/:id/heatmap-speed', getHeatmapSpeed);
router.get('/:id/history', getHistory);
router.get('/:id/networks', getNetworks);
router.get('/:id/export.csv', exportCsv);

router.get('/:id/ap-mappings', getMappings);
router.post('/:id/ap-mappings', createMapping);

router.delete('/access-points/:apId', removeAccessPoint);
router.patch('/access-points/:apId', patchAccessPoint);
router.delete('/ap-mappings/:mappingId', removeMapping);

export default router;
