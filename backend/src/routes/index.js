import express from 'express';
import { getTermuxWifiScanInfo } from '../controllers/termuxscaninfoController.js';

// Route principale
const router = express.Router();

router.get('/', (req, res) => {
  res.send('Bienvenue sur l\'API de récupération des informations de scan WiFi depuis Termux !');
});

// Route pour récupérer les informations de scan WiFi
router.get('/wifi-scaninfo', async (req, res) => {
  try {
    const scanInfo = await getTermuxWifiScanInfo();
    res.json(scanInfo);
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});

export default router;