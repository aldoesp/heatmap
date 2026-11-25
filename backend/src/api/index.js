import { Router } from 'express';
import scanRoutes from '../routes/scan.routes.js';
import plansRoutes from '../routes/plans.routes.js';
import surveysRoutes from '../routes/surveys.routes.js';
import bssidRulesRoutes from '../routes/bssidRules.routes.js';
import importRoutes from '../routes/import.routes.js';
import { getStatus, getIperfStatus, getSettings, patchSettings } from '../controllers/settings.controller.js';
import { getDataRevision, trackMutation } from '../cache/dataRevision.js';

const api = Router();

api.use(trackMutation);
api.get('/revision', (_req, res) => {
  res.set('Cache-Control', 'no-store').type('json').end(JSON.stringify(getDataRevision()));
});
api.get('/health', (_req, res) => res.json({ status: 'ok' }));
api.get('/status', getStatus);
api.get('/settings/iperf-status', getIperfStatus);
api.get('/settings', getSettings);
api.patch('/settings', patchSettings);
api.use('/scan', scanRoutes);
api.use('/plans', plansRoutes);
api.use('/surveys', surveysRoutes);
api.use('/bssid-rules', bssidRulesRoutes);
api.use('/import', importRoutes);

export default api;
