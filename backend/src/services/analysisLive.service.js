import { findSurveyById } from '../repositories/surveys.repository.js';
import { getNormalizedScan } from './scan.services.js';
import { AppError } from '../utils/AppError.js';

export async function getLiveAnalysis(survey_id) {
  if (!findSurveyById(survey_id)) {
    throw new AppError('Survey introuvable.', 404);
  }

  const scan = await getNormalizedScan();
  return { survey_id, ...scan };
}
