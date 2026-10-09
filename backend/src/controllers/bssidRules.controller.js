import { AppError } from '../utils/AppError.js';
import {
  deleteBssidRule,
  findBssidRuleById,
  insertBssidRule,
  listBssidRules,
  updateBssidRule,
} from '../repositories/bssidRules.repository.js';

const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const getBssidRules = (_req, res) => {
  res.json(listBssidRules());
};

export const createBssidRule = (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const bssid = String(req.body?.bssid ?? '').trim().toLowerCase();
  const blacklisted = req.body?.blacklisted === true;
  if (!BSSID_RE.test(bssid)) {
    return next(new AppError('Adresse MAC invalide (ex. 9e:05:d6:96:e8:30).', 400));
  }
  if (name.length > 64 || (!name && !blacklisted)) {
    return next(new AppError('Donne un nom, ou ajoute ce BSSID à la liste noire.', 400));
  }
  if (req.body?.blacklisted !== undefined && typeof req.body.blacklisted !== 'boolean') {
    return next(new AppError('blacklisted doit être un booléen.', 400));
  }
  try {
    res.status(201).json(insertBssidRule({ bssid, name, blacklisted }));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return next(new AppError('Ce BSSID possède déjà un réglage.', 409));
    }
    next(err);
  }
};

export const patchBssidRule = (req, res, next) => {
  const existing = findBssidRuleById(req.params.id);
  if (!existing) return next(new AppError('Réglage BSSID introuvable.', 404));
  const name =
    req.body?.name === undefined
      ? existing.name
      : typeof req.body.name === 'string'
        ? req.body.name.trim()
        : null;
  const blacklisted =
    req.body?.blacklisted === undefined ? existing.blacklisted : req.body.blacklisted;
  if (name === null || name.length > 64) {
    return next(new AppError('Nom de borne invalide.', 400));
  }
  if (typeof blacklisted !== 'boolean') {
    return next(new AppError('blacklisted doit être un booléen.', 400));
  }
  if (!name && !blacklisted) {
    return next(new AppError('Donne un nom ou active la liste noire.', 400));
  }
  res.json(updateBssidRule(existing.id, { name, blacklisted }));
};

export const removeBssidRule = (req, res, next) => {
  if (!deleteBssidRule(req.params.id)) {
    return next(new AppError('Réglage BSSID introuvable.', 404));
  }
  res.status(204).end();
};
