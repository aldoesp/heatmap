import { AppError } from '../utils/AppError.js';

const isValidCoord = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
const parseCoord = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value);
  return Number.NaN;
};

function readName(req, res, next) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 120) {
    return next(new AppError('Nom de survey invalide.', 400));
  }
  req.surveyName = name;
  next();
}

export const validateSurveyName = readName;
export const validateCreateSurvey = readName;

export const validateSurveyPoint = (req, _res, next) => {
  const x = parseCoord(req.body?.x);
  const y = parseCoord(req.body?.y);
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return next(new AppError('Coordonnées x/y invalides (0-1 attendu).', 400));
  }
  req.surveyPoint = { x, y };
  next();
};

export const validateSurveyPointPatch = (req, _res, next) => {
  const patch = {};
  if (req.body?.note !== undefined) {
    if (typeof req.body.note !== 'string') {
      return next(new AppError('Note invalide.', 400));
    }
    const note = req.body.note.trim();
    if (!note || note.length > 500) {
      return next(new AppError('La note doit contenir entre 1 et 500 caractères.', 400));
    }
    patch.note = note;
  }
  if (req.body?.is_enabled !== undefined) {
    const value = req.body.is_enabled;
    if (![0, 1, false, true].includes(value)) {
      return next(new AppError('is_enabled doit être 0 ou 1.', 400));
    }
    patch.is_enabled = value ? 1 : 0;
  }
  if (Object.keys(patch).length === 0) {
    return next(new AppError('Rien à mettre à jour.', 400));
  }
  req.surveyPointPatch = patch;
  next();
};

export const validateSurveyHeatmap = (req, _res, next) => {
  const { ssid, bssid, connected } = req.query;
  if (ssid !== undefined && typeof ssid !== 'string') {
    return next(new AppError('ssid invalide.', 400));
  }
  if (bssid !== undefined && typeof bssid !== 'string') {
    return next(new AppError('bssid invalide.', 400));
  }
  if (connected !== undefined && !['0', '1', 'true', 'false'].includes(connected)) {
    return next(new AppError('connected doit être 0, 1, true ou false.', 400));
  }
  req.surveyHeatmapFilters = {
    ssid: ssid || undefined,
    bssid: bssid || undefined,
    connected: connected === '1' || connected === 'true',
  };
  next();
};
