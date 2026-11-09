# Plan : amélioration de l'export ZIP heatmap

## Contexte / état actuel

`frontend/src/lib/exportZip.ts` contient déjà :
- `crc32Stream(blob)` : CRC32 en stream (pas de chargement intégral en mémoire), utilisé par `PngZip.add`.
- `sanitizeZipName(name, maxLen)` : nettoyage de nom de fichier.
- Limite mémoire 256 Mo sur le ZIP.

`frontend/src/components/heatmap/HeatmapPage.tsx` (`handleExportZip`, lignes 673-738) :
- crée **un seul** Worker avant la boucle (réutilisé pour tous les BSSID),
- traite les BSSID **séquentiellement**,
- jette l'erreur au premier BSSID sans mesure (échoue tout l'export),
- nom de fichier via regex directe `target.replace(/[^a-zA-Z0-9_-]/g, '-')` (pas `sanitizeZipName`),
- progression sans étape (récupération/rasterisation/compression),
- annulation via `worker.terminate()` seul,
- pas de `manifest.json` dans le ZIP,
- `downloadBlob` via `URL.createObjectURL` + `<a download>`,
- pas de cache des mesures.

Décisions confirmées avec l'utilisateur : **concurrence 2 BSSID**, **ZIP partiel si quelques BSSID échouent** (récap d'erreurs), **manifest.json inclus**, **seuil d'avertissement de téléchargement à 50 Mo**.

## Tâches (ordre d'implémentation)

1. **exportZip.ts — manifest JSON**
   - Ajouter une méthode `addManifest(manifest)` ou intégrer dans `finish()` une entrée `manifest.json` avec : `format`, `version`, `exportedAt`, `plan` (id, name, width, height), `images[]` (file, bssid, ssid, band, calculation).
   - `PngZip.add` reste inchangé (déjà stream-CRC + limite).

2. **HeatmapPage.tsx — noms de fichiers via `sanitizeZipName`**
   - Remplacer la regex inline (ligne 719) par `sanitizeZipName(base, 50)` + `sanitizeZipName(target, 30)`, fallback `'bssid'`.

3. **HeatmapPage.tsx — cache des mesures (session-scopé)**
   - `Map<string, HeatmapRow[]>` clé = `${planId}|${ssid}|${bssid}|${band}|${connected}`.
   - Dans la boucle, lire le cache avant `getHeatmap`, écrire après.

4. **HeatmapPage.tsx — parallélisation BSSID (concurrence 2)**
   - Remplacer la `for..of` séquentielle par un traitement par file avec jusqu'à 2 worker-tâches simultanées.
   - Chaque tâche : fetch mesures → rendu worker → `createPlanPngBlob` → `zip.add`.
   - `PngZip.add` n'est pas thread-safe dans le sens où l'ordre d'écriture du central directory n'importe pas pour un ZIP stored, mais les `add` doivent être sérialisés sur l'instance `zip` (attendre chaque `add` avant le suivant) pour éviter les races sur `this.size`/`this.names`.
   - Stratégie : exécuter jusqu'à 2 pipelines en parallèle, mais faire les `zip.add` de façon sérialisée (ou collecter les blobs puis ajouter séquentiellement).

5. **HeatmapPage.tsx — gestion d'erreur par BSSID (ZIP partiel)**
   - Envelopper chaque BSSID dans `try/catch` ; pousser les échecs dans un tableau `errors` sans arrêter la boucle.
   - Si `errors.length > 0` et qu'au moins une image a été ajoutée : télécharger le ZIP partiel + afficher le récap d'erreurs dans `batchError`.
   - Si aucune image n'a été ajoutée : erreur totale (comportement actuel).

6. **HeatmapPage.tsx — progression par étape**
   - `setBatchProgress(... · Récupération…)`, `… · Rasterisation…`, `… · Compression…`, `… · Écriture ZIP…`.

7. **HeatmapPage.tsx — annulation propre**
   - Avant `terminate()`, poster `{ type: 'cancel', id }` au worker (ajouter la gestion d'un flag `cancel` côté worker si nécessaire) puis `terminate()`, retirer les écouteurs d'abort.

8. **exportPng.ts / downloadBlob — seuil de taille**
   - Si `blob.size > 50 * 1024 * 1024`, afficher un avertissement (ou proposer un mécanisme par chunk) avant le `<a download>`. À défaut de chunking réel, un avertissement suffit.

9. **Tests — `frontend/src/lib/exportZip.test.ts`**
   - `crc32Stream` vs `crc32` cohérence sur plusieurs tailles.
   - `sanitizeZipName` (caractères spéciaux, noms vides, troncature).
   - `PngZip` round-trip : ajouter un blob, finir, vérifier qu'il s'ouvre comme ZIP valide (lecture des entrées + CRC).
   - `manifest.json` présent dans le ZIP fini.

## Validation
- `npm run lint` (eslint) depuis `frontend/`.
- `npm run test` (tsc + node --test) depuis `frontend/`.
- Vérifier manuellement : export de plusieurs BSSID, annulation en cours, un BSSID sans mesure (ZIP partiel + erreur), ZIP > 50 Mo (avertissement).

## Hors scope
- Chunked download réel (ReadableStream) : laissé en avertissement seulement.
- Persistance du cache au-delà de la session (pas de localStorage/IndexedDB).

## Livrable
Modifications uniquement dans `frontend/src/lib/exportZip.ts`, `frontend/src/components/heatmap/HeatmapPage.tsx`, `frontend/src/lib/exportPng.ts` (+ nouveau fichier de test). Aucun commit.
