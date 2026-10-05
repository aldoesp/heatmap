// Route pour récupérer les informations de scan WiFi
router.get('/wifi-scaninfo', async (req, res) => {
  try {
    const scanInfo = await getTermuxWifiScanInfo();
    res.json(scanInfo);
  } catch (error) {
    res.status(500).json({ error: error.toString() });
  }
});
