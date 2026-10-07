import 'dotenv/config';
import { getDb } from './database/db.js';
import app from './app.js';

getDb(); // crée data/heatmap.db + tables si besoin

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `API sur http://localhost:${PORT}/api/v1 — mode : ${process.env.SCAN_MODE === 'test' ? 'test' : 'live'}`
  );
});