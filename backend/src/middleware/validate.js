import { validateScanQuery } from '../validators/scan.validator.js';
import { AppError } from '../utils/AppError.js';

export const validateScanRequest = (req, _res, next) => {
  const { errors, filters } = validateScanQuery(req.query);
  if (errors.length) return next(new AppError('Paramètres invalides', 400, errors));
  req.filters = filters;
  next();
};