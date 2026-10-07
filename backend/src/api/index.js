import { Router } from 'express';
import scanRoutes from '../routes/scan.routes.js';
import plansRoutes from '../routes/plans.routes.js';

const api = Router();

api.get('/health', (_req, res) => res.json({ status: 'ok' }));
api.use('/scan', scanRoutes);
api.use('/plans', plansRoutes);

export default api;