import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Charge backend/.env quel que soit le dossier depuis lequel on lance node
// (sous Termux on démarre souvent depuis la racine du dépôt).
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
});
import { getDb } from './database/db.js';
import app from './app.js';

getDb(); // crée data/heatmap.db + tables si besoin

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Impossible d'écouter sur le port ${PORT} : ${err.code ?? err.message}`);
    process.exit(1);
  }
  console.log(
    `API sur http://localhost:${PORT}/api/v1 — mode : ${process.env.SCAN_MODE === 'test' ? 'test' : 'live'}`
  );
});