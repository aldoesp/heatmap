import { AppError } from '../utils/AppError.js';
import { findPlanById } from '../repositories/plans.repository.js';
import {
  deleteSurvey as deleteSurveyRow,
  findSurveyById,
  insertSurvey,
  listSurveysByPlan,
  renameSurvey as renameSurveyRow,
} from '../repositories/surveys.repository.js';
import {
  deleteScanPoint,
  findScanPointById,
  insertScanPoint,
  listScanPointsBySurvey,
  updateScanPoint,
} from '../repositories/scanPoints.repository.js';
import {
  exportSurveyCsv,
  getHistoryBySurvey,
  heatmapBySurvey,
  listNetworksBySurvey,
  speedBySurvey,
} from '../repositories/scans.repository.js';

const requireSurvey = (id) => {
  const survey = findSurveyById(id);
  if (!survey) throw new AppError('Survey introuvable.', 404);
  return survey;
};

export function getSurveysForPlan(plan_id) {
  if (!findPlanById(plan_id)) throw new AppError('Plan introuvable.', 404);
  return listSurveysByPlan(plan_id);
}

export function createSurvey(plan_id, name) {
  if (!findPlanById(plan_id)) throw new AppError('Plan introuvable.', 404);
  return insertSurvey({ plan_id, name });
}

export function getSurvey(id) {
  return requireSurvey(id);
}

export function renameSurvey(id, name) {
  requireSurvey(id);
  return renameSurveyRow(id, name);
}

export function removeSurvey(id) {
  requireSurvey(id);
  deleteSurveyRow(id);
}

export function getSurveyHistory(id) {
  requireSurvey(id);
  return getHistoryBySurvey(id);
}

export function getSurveyHeatmap(id, filters) {
  requireSurvey(id);
  return heatmapBySurvey(id, filters);
}

export function getSurveySpeed(id) {
  requireSurvey(id);
  return speedBySurvey(id);
}

export function getSurveyNetworks(id) {
  requireSurvey(id);
  return listNetworksBySurvey(id);
}

export function getSurveyCsv(id) {
  requireSurvey(id);
  return exportSurveyCsv(id);
}

export function getSurveyScanPoints(id) {
  requireSurvey(id);
  return listScanPointsBySurvey(id);
}

export function createSurveyScanPoint(id, { x, y }) {
  const survey = requireSurvey(id);
  return insertScanPoint({ plan_id: survey.plan_id, survey_id: survey.id, x, y });
}

export function updateSurveyScanPoint(id, point_id, patch) {
  requireSurvey(id);
  const point = findScanPointById(point_id);
  if (!point || point.survey_id !== id) {
    throw new AppError('Point de scan introuvable pour ce survey.', 404);
  }
  const updated = updateScanPoint(point.id, patch);
  if (!updated) throw new AppError('Point de scan introuvable pour ce survey.', 404);
  return updated;
}

export function removeSurveyScanPoint(id, point_id) {
  requireSurvey(id);
  const point = findScanPointById(point_id);
  if (!point || point.survey_id !== id) {
    throw new AppError('Point de scan introuvable pour ce survey.', 404);
  }
  deleteScanPoint(point.id);
}
