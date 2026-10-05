// Récupération des informations venant de termux-wifi-scaninfo
import { exec } from 'child_process';

export function getTermuxWifiScanInfo() {
  return new Promise((resolve, reject) => {
    exec('termux-wifi-scaninfo', (error, stdout, stderr) => {
      if (error) {
        reject(`Erreur lors de l'exécution de la commande: ${error.message}`);
        return;
      }
      if (stderr) {
        reject(`Erreur dans la sortie standard: ${stderr}`);
        return;
      }
      try {
        const scanInfo = JSON.parse(stdout);
        resolve(scanInfo);
      } catch (parseError) {
        reject(`Erreur lors de l'analyse du JSON: ${parseError.message}`);
      }
    });
  });
}

