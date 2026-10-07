import { AppError } from '../utils/AppError.js';
import { getAllSettings, setSetting, SETTING_KEYS } from '../repositories/settings.repository.js';
import { getScanMode } from '../services/termuxscaninfo.service.js';
import { checkIperf } from '../services/iperf.service.js';

export const getStatus = (_req, res) => {
  res.json({
    scan_mode: getScanMode(),
    node: process.version,
    platform: process.platform,
  });
};

export const getIperfStatus = async (_req, res, next) => {
  try {
    res.json(await checkIperf());
  } catch (err) {
    next(err);
  }
};

export const getSettings = (_req, res) => {
  res.json(getAllSettings());
};

export const patchSettings = (req, res, next) => {
  const { key, value } = req.body ?? {};
  if (!SETTING_KEYS.includes(key)) {
    return next(new AppError(`Réglage inconnu (attendu : ${SETTING_KEYS.join(', ')}).`, 400));
  }
  const str = String(value ?? '').trim();
  if (key === 'iperf_server') {
    if (str && (str.length > 253 || /[\s]/.test(str))) {
      return next(new AppError('Adresse de serveur iperf invalide.', 400));
    }
  }
  if (key === 'iperf_duration_s') {
    if (str !== '' && (!/^\d+$/.test(str) || Number(str) < 1 || Number(str) > 30)) {
      return next(new AppError('La durée doit être entre 1 et 30 secondes.', 400));
    }
  }
  if (key === 'scan_mode') {
    if (!['test', 'live', ''].includes(str)) {
      return next(new AppError("Le mode doit être 'test', 'live' ou vide (suit SCAN_MODE).", 400));
    }
  }
  res.json(setSetting(key, str));
};
