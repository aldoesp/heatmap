import { AppError } from '../utils/AppError.js';
import { listStrongestObservationsBySurvey } from '../repositories/analysis.repository.js';
import { findSurveyById } from '../repositories/surveys.repository.js';

export function getAnalysisHistory(survey_id) {
  if (!findSurveyById(survey_id)) {
    throw new AppError('Survey introuvable.', 404);
  }

  const data = listStrongestObservationsBySurvey(survey_id);
  return { survey_id, count: data.length, data };
}
