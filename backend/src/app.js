import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { UPLOADS_DIRECTORY } from './services/plans.service.js';
import api from './api/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIRECTORY, { fallthrough: false }));
app.use(requestLogger);

// Limite large sur l'API ; les routes de scan ont leur propre limite stricte.
app.use('/api', apiLimiter);

app.use('/api/v1', api);

app.use(notFound);
app.use(errorHandler);

export default app;