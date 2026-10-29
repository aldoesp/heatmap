import { importCsvSurvey } from '../services/csvImport.service.js';
import { AppError } from '../utils/AppError.js';

const run = (handler) => (req, res, next) => {
  try {
    handler(req, res);
  } catch (error) {
    next(error);
  }
};

export const importCsv = run((req, res) => {
  let content = '';
  if (req.file) {
    content = req.file.buffer?.toString('utf-8') || req.file.text?.() || '';
    if (typeof content !== 'string' && req.file.buffer) {
      content = req.file.buffer.toString('utf-8');
    }
  } else if (typeof req.body?.csv === 'string') {
    content = req.body.csv;
  } else if (typeof req.body === 'string') {
    content = req.body;
  }
  if (!content || content.trim() === '') {
    throw new AppError('Fichier CSV vide ou manquant.', 400);
  }
  const result = importCsvSurvey(content, {
    planName: req.body?.planName || req.body?.name,
    surveyName: req.body?.surveyName || req.body?.name,
  });
  res.status(201).json(result);
});
