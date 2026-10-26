import { pingStats } from './pingStats.js';

const result = await pingStats('google.com');

// 1. Objet brut
console.log(result);

// 2. Tableau lisible
console.table([result]);

// 3. Ligne formatée
console.log(
  `[${result.ts}] ${result.host} | latence=${result.latency ?? 'N/A'} ms | gigue=${result.jitter ?? 'N/A'} ms | perte=${result.loss}%`
);

// 4. JSON indenté (pour copier/coller ou stocker)
console.log(JSON.stringify(result, null, 2));
