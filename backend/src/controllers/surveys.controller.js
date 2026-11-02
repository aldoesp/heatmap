import { buildSurveyExportZip } from '../services/surveyExport.service.js';
import {
  executeSurveyImport,
  parseSurveyExportZip,
  previewSurveyImport as buildSurveyImportPreview,
} from '../services/surveyImport.service.js';
import { AppError } from '../utils/AppError.js';
import {
  createSurvey,
  createSurveyScanPoint,
  getSurvey,
  getSurveyCsv,
  getSurveyHeatmap,
  getSurveyHistory,
  getSurveyNetworks,
  getSurveyScanPoints,
  getSurveySpeed,
  getSurveysForPlan,
  removeSurvey,
  removeSurveyScanPoint,
  renameSurvey,
  updateSurveyScanPoint,
} from '../services/surveys.service.js';

const run = (handler) => (req, res, next) => {
  try {
    handler(req, res);
  } catch (error) {
    next(error);
  }
};

export const listSurveys = run((req, res) => {
  res.json(getSurveysForPlan(req.params.planId));
});

export const createSurveyForPlan = run((req, res) => {
  res.status(201).json(createSurvey(req.params.planId, req.surveyName));
});

export const readSurvey = run((req, res) => {
  res.json(getSurvey(req.params.surveyId));
});

export const patchSurvey = run((req, res) => {
  res.json(renameSurvey(req.params.surveyId, req.surveyName));
});

export const deleteSurvey = run((req, res) => {
  removeSurvey(req.params.surveyId);
  res.status(204).end();
});

export const readSurveyHistory = run((req, res) => {
  res.json(getSurveyHistory(req.params.surveyId));
});

export const readSurveyHeatmap = run((req, res) => {
  res.json(getSurveyHeatmap(req.params.surveyId, req.surveyHeatmapFilters));
});

export const readSurveySpeed = run((req, res) => {
  res.json(getSurveySpeed(req.params.surveyId));
});

export const readSurveyNetworks = run((req, res) => {
  res.json(getSurveyNetworks(req.params.surveyId));
});

export const exportSurvey = run((req, res) => {
  const survey = getSurvey(req.params.surveyId);
  const csv = getSurveyCsv(survey.id);
  const safeName = survey.name.replace(/[^\w\-àâäéèêëîïôöùûüç]+/gi, '_').slice(0, 60) || 'survey';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-releves.csv"`);
  res.send('\ufeff' + csv);
});

const queryList = (value) => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values
    .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const exportTimestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
};

export const exportSurveysZip = run((req, res) => {
  const zip = buildSurveyExportZip({
    surveyIds: queryList(req.query.ids),
    planIds: queryList(req.query.planIds),
  });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="heatmap-surveys-${exportTimestamp()}.zip"`
  );
  res.send(Buffer.from(zip));
});

export const previewSurveyImport = run((req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Fichier ZIP manquant.', 400);
  }
  const parsed = parseSurveyExportZip(req.file.buffer);
  res.json(buildSurveyImportPreview(parsed));
});

export const importSurveys = run((req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Fichier ZIP manquant.', 400);
  }

  let resolutions = {};
  if (req.body?.resolutions !== undefined && String(req.body.resolutions).trim() !== '') {
    try {
      resolutions = JSON.parse(req.body.resolutions);
    } catch {
      throw new AppError('Champ resolutions invalide (JSON attendu).', 400);
    }
    if (!resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions)) {
      throw new AppError('Champ resolutions invalide (objet attendu).', 400);
    }
  }

  const parsed = parseSurveyExportZip(req.file.buffer);
  res.status(201).json(executeSurveyImport(parsed, resolutions));
});

export const readSurveyScanPoints = run((req, res) => {
  res.json(getSurveyScanPoints(req.params.surveyId));
});

export const createSurveyPoint = run((req, res) => {
  res.status(201).json(createSurveyScanPoint(req.params.surveyId, req.surveyPoint));
});

export const patchSurveyPoint = run((req, res) => {
  res.json(updateSurveyScanPoint(req.params.surveyId, req.params.pointId, req.surveyPointPatch));
});

export const deleteSurveyPoint = run((req, res) => {
  removeSurveyScanPoint(req.params.surveyId, req.params.pointId);
  res.status(204).end();
});
