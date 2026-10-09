import { getAnalysisHistory } from '../services/analysisHistory.service.js';
import { getLiveAnalysis } from '../services/analysisLive.service.js';

export const readLiveAnalysis = async (req, res, next) => {
  try {
    res.json(await getLiveAnalysis(req.params.surveyId));
  } catch (error) {
    next(error);
  }
};

export const readAnalysisHistory = (req, res, next) => {
  try {
    res.json(getAnalysisHistory(req.params.surveyId));
  } catch (error) {
    next(error);
  }
};
