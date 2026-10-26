import { AppError } from '../utils/AppError.js';
import { findPlanById } from '../repositories/plans.repository.js';
import {
  findAccessPointById,
} from '../repositories/accessPoints.repository.js';
import {
  insertScenario,
  listScenariosByPlan,
  findScenarioById,
  updateScenario,
  resetScenario,
  deleteScenario,
} from '../repositories/simulationScenarios.repository.js';

/* ==========================================================================
   Validation
   ========================================================================== */

const isValidCoord = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

// Bornes alignées sur les limites de l'UI (frontend/src/components/simulation/SimulatorControls.tsx).
const FREQUENCY_MHZ = [2400, 5000, 6000];
const ANTENNA_IDS = ['isotropic', 'u7-pro-xgs'];
const MODELS = ['fspl', 'log-distance'];

function requireNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('La configuration radio doit contenir des nombres valides.', 400);
  }
  return value;
}

/**
 * Valide et borne une configuration radio reçue du client.
 * Champs identiques à RadioParams côté frontend (frontend/src/types/wifi.ts).
 */
export function validateRadioInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Configuration radio absente ou invalide.', 400);
  }
  const frequencyMHz = requireNumber(input.frequencyMHz);
  if (!FREQUENCY_MHZ.includes(frequencyMHz)) {
    throw new AppError(`frequencyMHz doit être ${FREQUENCY_MHZ.join(' ou ')}.`, 400);
  }
  if (!ANTENNA_IDS.includes(input.antennaId)) {
    throw new AppError(`antennaId doit être ${ANTENNA_IDS.join(' ou ')}.`, 400);
  }
  if (!MODELS.includes(input.model)) {
    throw new AppError(`model doit être ${MODELS.join(' ou ')}.`, 400);
  }
  const bounded = (label, min, max) => {
    const v = requireNumber(input[label]);
    if (v < min || v > max) {
      throw new AppError(`${label} doit être entre ${min} et ${max}.`, 400);
    }
    return v;
  };
  return {
    frequencyMHz,
    txPowerDbm: bounded('txPowerDbm', 0, 30),
    antennaId: input.antennaId,
    apRotationDeg: bounded('apRotationDeg', 0, 359),
    apHeightM: bounded('apHeightM', 0.5, 20),
    rxHeightM: bounded('rxHeightM', 0, 5),
    rxGainDbi: bounded('rxGainDbi', -10, 15),
    model: input.model,
    pathLossExponent: bounded('pathLossExponent', 1, 6),
    referenceDistanceM: bounded('referenceDistanceM', 0.1, 10),
    minDistanceM: bounded('minDistanceM', 0.01, 10),
  };
}

/* ==========================================================================
   Handlers
   ========================================================================== */

// POST /api/v1/simulation-scenarios
// body : { plan_id, sourceAccessPointId, name? }
// La copie est initialisée sur la position de l'AP source ; initial = current.
export const createScenario = (req, res, next) => {
  try {
    const plan = findPlanById(req.body?.plan_id);
    if (!plan) return next(new AppError('Plan introuvable.', 404));

    const sourceAccessPointId = req.body?.sourceAccessPointId;
    if (typeof sourceAccessPointId !== 'string' || !sourceAccessPointId) {
      return next(new AppError('sourceAccessPointId est requis (copie d’un AP réel).', 400));
    }
    const ap = findAccessPointById(sourceAccessPointId);
    if (!ap || ap.plan_id !== plan.id) {
      return next(new AppError('Point d’accès introuvable pour ce plan.', 404));
    }

    const radio = validateRadioInput(req.body?.radio);
    const name = String(req.body?.name ?? '').trim() || `Scénario – ${ap.name}`;
    if (name.length > 120) {
      return next(new AppError('Nom de scénario trop long (120 max).', 400));
    }

    const row = insertScenario({
      plan_id: plan.id,
      source_access_point_id: ap.id,
      name,
      initial_x: ap.x,
      initial_y: ap.y,
      initial_radio: radio,
    });
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/simulation-scenarios?plan_id=...
export const listScenarios = (req, res, next) => {
  const planId = req.query?.plan_id;
  if (!planId) return next(new AppError('plan_id est requis.', 400));
  if (!findPlanById(planId)) return next(new AppError('Plan introuvable.', 404));
  res.json(listScenariosByPlan(planId));
};

export const getScenario = (req, res, next) => {
  const row = findScenarioById(req.params.id);
  if (!row) return next(new AppError('Scénario introuvable.', 404));
  res.json(row);
};

// PATCH /api/v1/simulation-scenarios/:id
// body : { currentX?, currentY?, radio?, name? } — jamais initial_*.
export const patchScenario = (req, res, next) => {
  try {
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 120) {
        return next(new AppError('Nom de scénario invalide (1..120).', 400));
      }
      patch.name = name;
    }
    for (const [key, column] of [['currentX', 'current_x'], ['currentY', 'current_y']]) {
      if (req.body?.[key] !== undefined) {
        const v = Number(req.body[key]);
        if (!isValidCoord(v)) {
          return next(new AppError(`${key} invalide (0-1 attendu).`, 400));
        }
        patch[column] = v;
      }
    }
    if (req.body?.radio !== undefined) {
      patch.radio = validateRadioInput(req.body.radio);
    }
    if (Object.keys(patch).length === 0) {
      return next(new AppError('Rien à mettre à jour.', 400));
    }
    if (!findScenarioById(req.params.id)) {
      return next(new AppError('Scénario introuvable.', 404));
    }
    res.json(updateScenario(req.params.id, patch));
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/simulation-scenarios/:id/reset — restaure initial_*.
export const resetScenarioById = (req, res, next) => {
  if (!findScenarioById(req.params.id)) {
    return next(new AppError('Scénario introuvable.', 404));
  }
  res.json(resetScenario(req.params.id));
};

export const removeScenario = (req, res, next) => {
  if (!deleteScenario(req.params.id)) {
    return next(new AppError('Scénario introuvable.', 404));
  }
  res.status(204).end();
};
