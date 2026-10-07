import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../utils/AppError.js';
import { getSetting } from '../repositories/settings.repository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '../../tests/wifi-scan-info-test.json');

// Priorité : réglage persisté en DB (bouton Test/Réel de l'UI),
// sinon variable d'environnement SCAN_MODE. Survit au redémarrage.
export const getScanMode = () => {
  try {
    const override = getSetting('scan_mode');
    if (override === 'test' || override === 'live') return override;
  } catch {
    /* DB pas encore prête : repli sur l'environnement */
  }
  return process.env.SCAN_MODE === 'test' ? 'test' : 'live';
};

const runTermux = () =>
  new Promise((resolve, reject) => {
    execFile('termux-wifi-scaninfo', [], { timeout: 15000 }, (err, stdout) => {
      if (err) return reject(new AppError(`termux-wifi-scaninfo a échoué : ${err.message}`, 502));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new AppError('Sortie termux-wifi-scaninfo non JSON', 502));
      }
    });
  });

const readFixture = async () => {
  try {
    return JSON.parse(await readFile(FIXTURE, 'utf8'));
  } catch (err) {
    throw new AppError(`Fixture illisible : ${err.message}`, 500);
  }
};

export const getTestScanData = () => readFixture();

// Retourne la sortie BRUTE (tableau)
export const collectRawScan = async () => {
  const raw = getScanMode() === 'test' ? await readFixture() : await runTermux();

  // Termux renvoie {"API_ERROR": "..."} si permission/localisation manquante
  if (raw && !Array.isArray(raw) && raw.API_ERROR) {
    throw new AppError(`Termux:API : ${raw.API_ERROR}`, 502);
  }
  return raw;
};