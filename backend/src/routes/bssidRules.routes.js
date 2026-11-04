import { Router } from 'express';
import {
  createBssidRule,
  getAllSeenBssids,
  getBssidRules,
  patchBssidRule,
  removeBssidRule,
} from '../controllers/bssidRules.controller.js';

const router = Router();

router.get('/', getBssidRules);
router.get('/seen', getAllSeenBssids);
router.post('/', createBssidRule);
router.patch('/:id', patchBssidRule);
router.delete('/:id', removeBssidRule);

export default router;
