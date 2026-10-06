import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import api from './api/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(requestLogger);

// Le scan Wi-Fi est coûteux : limite globale sur l'API
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Trop de requêtes, réessaie dans une minute' },
  })
);

app.use('/api/v1', api);

app.use(notFound);
app.use(errorHandler);

export default app;