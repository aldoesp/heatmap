import { rateLimit } from 'express-rate-limit';

const message = { error: 'Trop de requêtes, réessaie dans une minute' };

// Lectures/écritures légères : limite large (usage normal de l'UI).
// RATE_LIMIT_MAX reste supporté pour les tests automatisés.
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_API) || Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message,
});

// Scans Wi-Fi (+ iperf/ping éventuels) : coûteux, limite stricte.
export const scanLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.RATE_LIMIT_SCAN) || Number(process.env.RATE_LIMIT_MAX) || 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message,
});
