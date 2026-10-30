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
  if (key === 'heatmap_colours') {
    if (str !== '') {
      if (str.length > 4000) {
        return next(new AppError('Valeur de heatmap_colours trop longue.', 400));
      }
      let parsed;
      try {
        parsed = JSON.parse(str);
      } catch (err) {
        return next(new AppError('heatmap_colours doit être du JSON valide.', 400));
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return next(new AppError('heatmap_colours doit être un objet valide.', 400));
      }
      const { stops, opacityStrongest, opacityWeakest } = parsed;
      if (!Array.isArray(stops)) {
        return next(new AppError('heatmap_colours.stops doit être un tableau.', 400));
      }
      if (stops.length < 2 || stops.length > 12) {
        return next(new AppError('heatmap_colours doit contenir entre 2 et 12 stops.', 400));
      }
      for (const stop of stops) {
        if (!stop || typeof stop !== 'object' || Array.isArray(stop)) {
          return next(new AppError('Chaque stop heatmap_colours doit être un objet.', 400));
        }
        const pos = stop.position;
        const col = stop.color;
        const op = stop.opacity;
        if (typeof pos !== 'number' || Number.isNaN(pos) || pos < 0 || pos > 1) {
          return next(new AppError('La position de chaque stop doit être un nombre entre 0 et 1.', 400));
        }
        if (typeof col !== 'string' || !/^#[0-9a-f]{6}$/i.test(col)) {
          return next(new AppError('La couleur de chaque stop doit être au format #RRGGBB.', 400));
        }
        if (typeof op !== 'number' || Number.isNaN(op) || op < 0 || op > 1) {
          return next(new AppError("L'opacité de chaque stop doit être un nombre entre 0 et 1.", 400));
        }
      }
      if (typeof opacityStrongest !== 'number' || Number.isNaN(opacityStrongest) || opacityStrongest < 0 || opacityStrongest > 1) {
        return next(new AppError("opacityStrongest doit être un nombre entre 0 et 1.", 400));
      }
      if (typeof opacityWeakest !== 'number' || Number.isNaN(opacityWeakest) || opacityWeakest < 0 || opacityWeakest > 1) {
        return next(new AppError("opacityWeakest doit être un nombre entre 0 et 1.", 400));
      }
    }
  }
  res.json(setSetting(key, str));
};
