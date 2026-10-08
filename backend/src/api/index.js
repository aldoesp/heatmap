import { Router } from 'express';
import scanRoutes from '../routes/scan.routes.js';
import plansRoutes from '../routes/plans.routes.js';
import surveysRoutes from '../routes/surveys.routes.js';
import { scanLimiter } from '../middleware/rateLimit.js';
import { getStatus, getIperfStatus, getSettings, patchSettings } from '../controllers/settings.controller.js';

const api = Router();

api.get('/health', (_req, res) => res.json({ status: 'ok' }));
api.get('/status', getStatus);
api.get('/settings/iperf-status', getIperfStatus);
api.get('/settings', getSettings);
api.patch('/settings', patchSettings);
api.use('/scan', scanLimiter, scanRoutes);
api.use('/plans', plansRoutes);
api.use('/surveys', surveysRoutes);

export default api;