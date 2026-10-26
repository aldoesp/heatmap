import { Router } from 'express';
import {
  createScenario,
  listScenarios,
  getScenario,
  patchScenario,
  resetScenarioById,
  removeScenario,
} from '../controllers/simulationScenarios.controller.js';

const router = Router();

// Crée une copie indépendante d'un AP réel (initial = position de l'AP source).
router.post('/', createScenario);
// Liste par plan : GET /api/v1/simulation-scenarios?plan_id=...
router.get('/', listScenarios);
router.get('/:id', getScenario);
// Déplace la copie / change la radio / renomme : jamais initial_*.
router.patch('/:id', patchScenario);
// Restaure la configuration initiale du scénario.
router.post('/:id/reset', resetScenarioById);
router.delete('/:id', removeScenario);

export default router;
