import { Router } from 'express';
import multer from 'multer';
import { importCsv } from '../controllers/csvImport.controller.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.post('/csv', upload.single('file'), importCsv);
router.post('/csv', importCsv);
router.post('/', upload.single('file'), importCsv);

export default router;
