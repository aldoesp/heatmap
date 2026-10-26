import { execFile } from 'node:child_process';
import { normalizeBssid } from '../utils/wifi.utils.js';
import { getScanMode } from './termuxscaninfo.service.js';

// Lecture best-effort du réseau connecté (termux-wifi-connectioninfo).
// Retourne { ssid, bssid } normalisés ou null. N'échoue jamais : en mode
// test ou sans Termux:API, le scan reste utile sans marquage.
export async function collectConnectionInfo() {
  if (getScanMode() === 'test') return null;
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('termux-wifi-connectioninfo', [], { timeout: 8000 }, (err, out) =>
        err ? reject(err) : resolve(String(out ?? ''))
      );
    });
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return null;
    }
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== 'object') return null;
    const ssid = typeof record.ssid === 'string' ? record.ssid : '';
    const bssid = typeof record.bssid === 'string' ? normalizeBssid(record.bssid) : '';
    if (!ssid && !bssid) return null;
    return { ssid, bssid };
  } catch {
    return null;
  }
}
