import { Router } from 'express';
import scanRoutes from '../routes/scan.routes.js';

const api = Router();

api.get('/health', (_req, res) => res.json({ status: 'ok' }));
api.use('/scan', scanRoutes);

export default api;