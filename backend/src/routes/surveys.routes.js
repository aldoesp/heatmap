import { Router } from 'express';
import {
  deleteSurvey,
  deleteSurveyPoint,
  exportSurvey,
  patchSurvey,
  patchSurveyPoint,
  readSurvey,
  readSurveyHeatmap,
  readSurveyHistory,
  readSurveyNetworks,
  readSurveyScanPoints,
  readSurveySpeed,
  createSurveyPoint,
} from '../controllers/surveys.controller.js';
import {
  validateSurveyHeatmap,
  validateSurveyName,
  validateSurveyPoint,
  validateSurveyPointPatch,
} from '../middleware/surveys.middleware.js';

const router = Router();

router.get('/:surveyId', readSurvey);
router.patch('/:surveyId', validateSurveyName, patchSurvey);
router.delete('/:surveyId', deleteSurvey);

router.get('/:surveyId/history', readSurveyHistory);
router.get('/:surveyId/heatmap', validateSurveyHeatmap, readSurveyHeatmap);
router.get('/:surveyId/heatmap-speed', readSurveySpeed);
router.get('/:surveyId/networks', readSurveyNetworks);
router.get('/:surveyId/export.csv', exportSurvey);

router.get('/:surveyId/scan-points', readSurveyScanPoints);
router.post('/:surveyId/scan-points', validateSurveyPoint, createSurveyPoint);
router.patch('/:surveyId/scan-points/:pointId', validateSurveyPointPatch, patchSurveyPoint);
router.delete('/:surveyId/scan-points/:pointId', deleteSurveyPoint);

export default router;
