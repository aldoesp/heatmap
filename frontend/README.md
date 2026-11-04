# WiFi Heatmapper — Frontend

Interface mobile React de WiFi Heatmapper. Elle permet d'importer un plan,
réaliser des relevés Wi-Fi et visualiser la couverture estimée sur une heatmap.

## Commandes

```bash
npm run dev
npm run build
npm run lint
npm test
npx vitest run src/lib --maxWorkers=1
```

Le serveur de développement Vite démarre par défaut sur `http://localhost:5173`.

`npm test` exécute les tests Node du rendu et de la géométrie. La commande
Vitest vérifie les modèles et le simulateur dans `src/lib`.

Voir [l'intégration de la heatmap](../HEATMAP-INTEGRATION.md) pour le calcul
régularisé, les commandes de validation et les limites de l'estimation.
