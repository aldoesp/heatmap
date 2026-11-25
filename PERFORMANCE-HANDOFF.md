# Performance Heatmap

## Phase 6 · État final

Le [rapport de validation](benchmarks/phase6-report.md) rassemble les résultats avant/après, les contrôles fonctionnels et mémoire, les commandes de reproduction et la checklist HTTPS sur PC et smartphone. Les [mesures structurées](benchmarks/phase6-final.json) distinguent les comparaisons refaites en phase 6 des chiffres historiques.

- **Phase 0** · Référence et benchmarks, `1c2346c`.
- **Phase 1** · Optimisation SQL, `f817d22`.
- **Phases 2 et 3** · Calcul raster et cache d’affichage intégrés séparément, `a75b32d` et `162996b`.
- **Phases 4A à 4D** · Moteur backend, lectures, invalidations et benchmarks, `5028ee8`, `746e538`, `b950c9e` et `e021154`.
- **Phases 5A à 5C** · Moteur API, intégration et synchronisation, `ea62060`, `d9ea49c` et `6aa13ef`.
- **Phase 6** · Le commit `perf: finalize and validate Heatmap performance optimizations` contient cette validation, la correction de la concurrence de l’export ZIP et la correction du champ numérique signalé par le lint.

Configuration de livraison. Cache backend actif, cache raster actif, déduplication et synchronisation API actives. Opt-in du stockage avec `VITE_API_CACHE_ENABLED=true`. Pour les lectures backend en direct, démarrer avec `BACKEND_CACHE_ENABLED=false`. Les TTL, les limites mémoire et le polling de 5 s conservent leurs valeurs. Les sections suivantes conservent la chronologie technique.

- **Résultats**. Heatmap plan HTTP à chaud de 7,016 à 1,703 ms p50. Rendu régularisé sous Node de 7,91 à 1,57 s sur 800 mesures, avec les mêmes pixels. Réaffichage Chromium à 6,6 ms en médiane avec le cache raster. Dans le parcours API répété, le stockage optionnel réduit les HTTP de 58,6 % et les octets de 32,3 % par rapport au témoin dédupliqué.
- **Mémoire**. 23,21 Mio estimés après saturation à 30 rasters. Cache API à 71,6 Kio au plus aux points de contrôle du scénario de stabilité. Le cache backend atteint 62,81 Mio estimés en forte charge. Le processus de ce test reste entre 418,8 et 419,2 Mio de RSS après GC forcé. Deux onglets visibles génèrent 26 polls en 65 s, sans lecture métier.
- **Tests**. 105 backend avec cache et 105 sans, 230 frontend, build et lint passent. Chromium vérifie la cohérence entre deux contextes, la reconnexion, le redémarrage et les exports PNG et ZIP. Le scénario multi-BSSID forcé passe après correction du conflit de workers.
- **GO conditionnel**. Vérifier les appareils physiques et le proxy HTTPS habituel avant déploiement sur le terrain ou activation du stockage API par défaut. La calibration et la persistance des scénarios renvoient HTTP 404 sur la référence et sur la branche finale. Elles conditionnent la mise en service si elles sont requises.

## Phase 3 · Cache des rasters Heatmap

Le cache d’affichage vit sur le thread principal et survit à la fermeture du worker qui a produit le raster. Le LRU accepte jusqu’à 30 entrées et 32 Mio par défaut. `createHeatmapDisplayCache` accepte `maxEntries` et `maxBytes`. Ses compteurs cumulés sont accessibles via `stats()`. Les requêtes jointes à un calcul en cours comptent comme des misses et sont également comptées dans `coalesced`.

Le budget estimé couvre le buffer RGBA, la clé sérialisée, les contours et les métadonnées conservées. Une entrée trop volumineuse reste utilisable pour l’affichage courant et est écartée du LRU. L’estimation exclut les allocations transitoires des workers, les copies en cours de consommation et les URL de blob. Elle ne mesure pas la mémoire du processus Chromium.

La clé encode les dimensions du plan et du raster effectif, l’ordre et les coordonnées des polygones, ainsi que les entrées propres au mode. Pour le RSSI, elle comprend le contenu des lignes filtrées, notamment le relevé, la position, la radio, la bande, la fréquence et le RSSI. Les positions des bornes interviennent pour l’hybride zoné. Un filtre SSID intervient par sa sélection de lignes. La région d’export est découpée lors de la composition du PNG. Le zoom, l’opacité et la visibilité des marqueurs restent appliqués à l’affichage ou à la composition.

Un calcul à froid est partagé entre les consommateurs de la même clé. La dernière libération interrompt le worker, et seules les réponses du calcul encore actif peuvent remplir le cache. Chaque consommateur reçoit sa propre copie du résultat transféré au thread principal. Sur un hit, la première sonde prépare le champ dans un worker sans rasterisation. Les erreurs de rendu restent hors cache.

Les exports passent toujours par le worker et conservent leurs limites de résolution. Hors contours, un export 2048 × 1365 représente déjà 10,66 Mio de RGBA. L’exclusion des exports préserve le budget d’affichage. Quand un worker d’affichage est partagé, l’export utilise un worker propre au consommateur pour permettre son annulation indépendante.

## Reproduction

Depuis `frontend`, lancer `npm run dev -- --host 127.0.0.1 --port 5186 --strictPort`, puis ouvrir `http://127.0.0.1:5186/benchmarks/phase3-browser.html` dans Chromium. La page affiche le JSON après les deux exports 2048 et les parcours BSSID. Le scénario réutilise les données déterministes de la phase 2 et compare sur le même navigateur la navigation avec le cache actif et avec le stockage désactivé. Les durées d’affichage couvrent la demande du raster jusqu’à sa disponibilité, avant Canvas et l’encodage PNG.

Le premier raster est disponible en 1,57 s et un hit en 4,3 ms en médiane. Le retour à A passe de 996,2 ms à 6,4 ms. Le LRU se stabilise à 30 entrées et 23,21 Mio estimés après le parcours étendu. La première sonde sur un hit, qui démarre un worker et prépare le champ, a pris 128,6 ms sur ce scénario. Son résultat est identique à la sonde à froid. L’affichage et l’export 2048 conservent les empreintes de la phase 2. Les temps d’export varient d’une exécution à l’autre et les deux passages ne permettent pas d’isoler un écart de calcul. [Mesures et référence de phase 2](benchmarks/phase3-heatmap.json)

## État Git et validation

Les 188 tests frontend, le build de production et le lint ciblé passent. Le lint global signale les quatre erreurs `react-hooks/set-state-in-effect` déjà présentes dans `f817d22`, dans `SettingsPage.tsx` aux lignes 85 et 183, `SimulatorControls.tsx` à la ligne 42 et `useApPositions.ts` à la ligne 12. La phase 6 a intégré la phase 2 dans `a75b32d` et la phase 3 dans `162996b`.

## Phase 4A · Moteur de cache mémoire backend

`backend/src/cache/memoryCache.js` exporte `createMemoryCache(options)` pour les instances indépendantes et `memoryCache` comme instance partagée dans le processus Node. Les limites par défaut sont de 300 entrées, 64 Mio au total, 8 Mio par entrée et 60 000 ms de TTL. L’horloge `now` est injectable. L’expiration est vérifiée à l’accès et les entrées expirées sont balayées avant une éviction. Le moteur fonctionne sans timer.

`set` renvoie un booléen. Un TTL omis ou `undefined` utilise la valeur par défaut. Un TTL nul, négatif ou invalide, une valeur `undefined` et une entrée hors budget sont refusés. Une écriture refusée retire aussi l’ancienne valeur de la même clé. `getOrSet` appelle un loader synchrone sur un miss, renvoie son résultat même s’il est refusé par le cache, et laisse remonter son exception sans la stocker.

Construire les clés en joignant avec `:` des segments encodés par `encodeURIComponent`. Par exemple, le préfixe `heatmap:plan:1:` cible le plan `1` sans sélectionner le plan `10`. Conserver le séparateur final lors de l’invalidation d’un groupe. `invalidate('')` cible toutes les entrées.

L’estimation tient compte de la clé, du coût de l’entrée et des données accessibles par les propriétés propres énumérables à clé chaîne des objets simples et tableaux. Elle inclut le buffer sous-jacent d’un `Buffer` et compte les références partagées et cycles une fois par entrée. Les types complexes et les accesseurs sont hors du format pris en charge. L’estimation se fait à l’écriture et reste approximative par rapport à la mémoire V8 et aux allocations natives. Les valeurs sont conservées par référence et doivent être traitées en lecture seule.

`get` et `getOrSet` comptent chacun un hit ou un miss. `has` promeut l’entrée ou retire l’entrée expirée sans modifier le taux de hits. `delete` retire une clé et compte une éventuelle expiration. `invalidate` et `clear` comptent le nombre d’entrées retirées, y compris les expirations encore présentes. `resetStats` remet les compteurs à zéro et conserve le contenu, sa taille et son ordre LRU. Les mesures instantanées de `stats()` incluent les entrées expirées qui attendent encore leur nettoyage.

Validation depuis `backend` avec `node --test tests/memoryCache.test.js` et `npm test`.

## Phase 4B · Cache des lectures backend

L’activation centralisée dans `backend/src/cache/readCache.js` exige `BACKEND_CACHE_ENABLED=true`. Le cache est désactivé par défaut. Les lectures désactivées ou situées dans une transaction SQLite appellent directement le loader. `backend/src/database/db.js` vide l’instance partagée lors de `closeDb()`. Les contrôleurs et les services transmettent les résultats des repositories à la réponse sans les muter. Les valeurs mises en cache restent réservées à la lecture.

Les changements touchent `readCache.js`, les repositories `scans`, `bssidRules` et `analysis`, `db.js`, `backend/package.json` et `backend/tests/readCache.test.js`. Les fonctions suivantes partagent un TTL de 60 secondes. Leurs dépendances serviront à la phase 4C.

- `listAllSeenBssids` utilise `bssid:seen:all`. Invalider lors d’un changement des observations, de leur suppression en cascade ou des règles BSSID.
- `getHistoryByPlan` et `getHistoryBySurvey` utilisent `history:<plan|survey>:ID:all`. Invalider sur les changements de points, scans, observations, résultats de débit ou blacklist.
- `heatmapByPlan` et `heatmapBySurvey` utilisent `heatmap:<plan|survey>:ID:FILTERS`. Invalider sur les changements de position, d’activation ou de périmètre des points, de scans, d’observations ou de règles BSSID, alias inclus.
- `listNetworksByPlan` et `listNetworksBySurvey` utilisent `networks:<plan|survey>:ID:all`. Invalider sur les changements de scans, d’observations, de rattachement au survey ou de règles BSSID.
- `speedByPlan` et `speedBySurvey` utilisent `speed:<plan|survey>:ID:all`. Invalider sur les changements de points, de scans ou de tests de débit.
- `listStrongestObservationsBySurvey` utilise `analysis:survey:ID:strongest`. Invalider sur les changements de points, notes incluses, de scans, d’observations ou de règles BSSID.

Les segments sont encodés avec `encodeURIComponent` et joints par `:`. Utiliser le préfixe avec séparateur final pour invalider un périmètre, par exemple `heatmap:survey:ID:`. Le segment de filtres vaut `all` en l’absence de filtre actif. Sinon, il encode un tuple fixe SSID, BSSID, bande et connected. Seuls le passage du BSSID en minuscules, les filtres texte inactifs et la valeur booléenne de connected reprennent les équivalences du SQL. `minRssi` concerne les observations d’un scan et n’affecte pas les requêtes heatmap.

Les détails de scans dépendent notamment des règles BSSID ou des tests de débit et restent en lecture directe comme les référentiels plans et surveys. Les exports et les lectures temps réel continuent à interroger SQLite. Le cache introduit une seule couche de résultats et réutilise la gestion existante des statements.

### Validation

Les 7 tests d’intégration et les 12 tests unitaires du moteur passent. `npm test` valide 88 tests backend. Sur une base temporaire de 2 plans, 3 surveys et 1 350 observations, après 5 préchauffages et sur 25 itérations, les médianes cache désactivé, miss et hit sont respectivement de 1,531 / 1,601 / 0,016 ms pour les BSSID vus, 3,722 / 5,651 / 0,051 ms pour la heatmap plan et 2,980 / 3,384 / 0,034 ms pour l’analyse survey. L’admission coûte jusqu’à environ 1,93 ms sur ce petit scénario. Ces mesures se font sur une connexion SQLite déjà ouverte et ne sont pas directement comparables aux ouvertures à froid ou aux temps HTTP de `benchmarks/phase1-backend.json`.

Relancer depuis `backend` avec `BENCH_PHASE4B=1 node --test --test-isolation=none --test-name-pattern='mesures ciblées' tests/readCache.test.js`.

### Suite en phase 4C

Raccorder l’invalidation aux écritures réussies après commit SQLite. Couvrir les deux périmètres, plan et survey, les suppressions en cascade, les règles BSSID globales et les imports. Vérifier les parcours lecture–écriture–lecture et le rollback avant d’activer le cache par défaut.

## Phase 4C · Invalidation métier du cache backend

Le cache est actif par défaut. `BACKEND_CACHE_ENABLED=false` force les lectures directes. `true` l’active explicitement. Les autres valeurs explicites désactivent le cache. Le TTL de 60 secondes reste un filet de sécurité. La mémoire et les invalidations sont propres au processus Node. Les écritures directes dans SQLite depuis un autre processus ne déclenchent aucune invalidation.

### Dépendances et écritures couvertes

`backend/src/cache/invalidation.js` utilise les préfixes encodés et terminés par `:`, y compris pour toutes les variantes de filtres RSSI. Les préfixes sont dédupliqués avant éviction. Une résolution de périmètre manquante ou en échec déclenche un vidage conservateur.

- **Scan RSSI et observations** — historique, heatmap RSSI, réseaux et analyse dans les périmètres concernés, plus BSSID vus. Le plan et le survey du point sont résolus après le scan. Les réseaux plan tiennent aussi compte du plan porté par le scan.
- **Test de débit** — historique et débit du plan et du survey du point. Les entrées RSSI restent disponibles.
- **Point créé ou supprimé sans scan** — historique plan et survey. Une note invalide aussi l’analyse survey. Un changement d’activation invalide l’historique, le RSSI, le débit et l’analyse. Une suppression avec scans couvre toutes les familles de ces périmètres et les BSSID vus. L’API de mise à jour existante accepte la note et l’activation. Les coordonnées et le rattachement sont fournis à la création ou par import. Les migrations qui les modifient s’exécutent à l’ouverture, avant les lectures cachées.
- **Suppression de plan ou survey** — toutes les familles du plan et des surveys supprimés, plus BSSID vus. Les identifiants sont capturés avant la cascade. Les rattachements croisés autorisés par le schéma sont couverts. Les renommages de plans et de surveys conservent les entrées.
- **Règles BSSID** — BSSID vus, historiques, RSSI, réseaux et analyses sont invalidés globalement après écriture. Le débit ne dépend pas des règles.
- **Import ZIP** — vidage après la transaction réussie, y compris après fusion. En cas d’échec, SQLite annule les écritures et le nettoyage de fichiers existant s’applique.
- **Import CSV** — les points écrits directement invalident l’historique dans un bloc `finally`. Les scans et les débits utilisent l’invalidation de leurs repositories. Une interruption conserve les écritures déjà validées et leur invalidation. Le CSV garde son comportement sans transaction globale.

Une écriture réussie peut libérer un savepoint tandis qu’une transaction externe reste ouverte. Dans ce cas, l’éviction est immédiate et conservatrice. Les lectures contournent le cache pendant toute la transaction SQLite, donc un rollback externe peut faire perdre un hit mais ne peut pas publier de donnée non validée. Une écriture SQL échouée avant son invalidation conserve les entrées. `closeDb()` continue de vider le cache.

### Fichiers et validation

Les chemins d’écriture raccordés sont les repositories `scans`, `scanPoints`, `plans`, `surveys`, `bssidRules` et les services `csvImport` et `surveyImport`. La configuration centrale est dans `readCache.js`. Les tests couvrent les nouveaux cas dans `cacheInvalidation.test.js`, les imports ZIP dans `surveyExport.test.js` et les modes dans `readCache.test.js`. `backend/package.json` lance les fichiers de test en série pour éviter que les suites HTTP et ZIP se croisent dans le répertoire d’images partagé. Chaque base de test est temporaire.

Les trois exécutions de `npm test` passent avec 101 tests chacune, avec `BACKEND_CACHE_ENABLED=true`, `false` et sans variable. Les tests de mutation conservent le mode hérité et comparent les résultats aux lectures directes dans une transaction. Le test de configuration vérifie séparément la bascule. Sur 100 itérations avec 300 entrées et 10 variantes évincées, l’invalidation mémoire a pris 0,070 à 0,100 ms en médiane et 0,617 à 0,629 ms au p95 sur deux passages. Ces mesures excluent les requêtes SQL de résolution de périmètre.

Rejouer la mesure depuis `backend` avec `BENCH_PHASE4C=1 BACKEND_CACHE_ENABLED=true node --test --test-isolation=none --test-name-pattern='mesure ciblée' tests/cacheInvalidation.test.js`.

La phase 4D devra mesurer les lectures et écritures sur des volumes représentatifs, notamment le coût des misses, la résolution des périmètres de cascade, la mémoire et le taux de hits sur des parcours mixtes.

## Phase 4D · Validation et benchmarks du cache backend

Exécuter `npm --prefix backend run bench:phase4d` pour les volumes petit, référence et charge élevée. Les options `--volume=reference --iterations=30 --warmup=5` peuvent être passées après `--`. Le script partage le générateur et les agrégats du benchmark historique. Chaque volume exécute la même version backend et les mêmes données dans un processus avec SQLite et images temporaires. [Rapport](benchmarks/phase4d-report.md) · [Mesures et compteurs](benchmarks/phase4d-backend.json)

Sur 9 000 observations, la heatmap plan est passée en HTTP de 4,746 à 1,808 ms au p50 sur un hit, et de 3,999 à 0,022 ms au repository. Sur 90 000 observations, le miss repository de cette lecture a coûté 20,149 ms contre 14,920 ms cache désactivé. Les écarts négatifs de certaines médianes miss–désactivé restent sensibles au bruit de mesure.

En charge élevée, le parcours 90/10 a gagné 46,8 % avec 54,9 % de hits. Les parcours 70/30 et 50/50 ont ralenti de 26,8 % et 29,8 % avec 4 % et 0 % de hits. Ces scénarios synthétiques illustrent l’effet de la réutilisation entre invalidations. Ils ne décrivent pas la répartition réelle du trafic. Les hooks et leurs résolutions SQL continuent de fonctionner cache désactivé. Sur ce volume, le scan mesuré passe de 0,910 à 0,983 ms et la suppression d’un plan de 26,394 à 27,966 ms au p50, en incluant SQL et invalidations.

La charge élevée atteint 62,81 Mio estimés après la chauffe non filtrée, puis 4,46 à 5,01 Mio et 300 entrées en fin de tour filtre. Les relevés RSS, heap, external et arrayBuffers sont conservés séparément. L’essai contrôlé confirme l’éviction au budget total, le refus au budget unitaire et l’expiration à 60 s. Conserver les limites et le TTL actuels. Les gains les plus fiables concernent des lectures répétées, notamment l’analyse et les BSSID vus. Une réévaluation des familles peu réutilisées nécessiterait des mesures de trafic représentatives et une comparaison contrôlée.

Les 101 tests backend passent avec le cache activé puis désactivé, dans une copie temporaire du backend. Les réponses des modes désactivé, miss et hit ont des JSON identiques dans les trois volumes. Les lectures de contrôle après mutation et les tests 4C confirment les invalidations, les cascades, les imports et les rollbacks. Le cache reste actif par défaut et local au processus. Les durées historiques 0 et 1 sont des repères. Les gains rapportés proviennent des comparaisons 4D à conditions communes.

## Phase 5A · Moteur de cache API frontend

`createApiCache` crée des instances indépendantes. `apiCache` est l’instance partagée réservée à l’intégration en phase 5B. Le LRU sur `Map` utilise par défaut 100 entrées, 16 Mio au total, 2 Mio par entrée et un TTL de 15 s à partir de l’admission. Les limites et l’horloge sont configurables. La taille estimée est la somme des octets UTF-8 de la clé et du JSON, calculée à l’admission. Le budget exclut le surcoût du tas JavaScript et les allocations transitoires. Les valeurs sont partagées par référence et prévues pour un usage en lecture seule. L’expiration est vérifiée à la lecture et balayée à l’admission et dans `stats()`, sans timer ni stockage persistant.

Joindre par `:` des segments encodés avec `encodeURIComponent`. Chaque clé identifie un seul type de réponse et inclut les paramètres qui modifient son contenu. `invalidate(key)` et `delete(key)` ciblent une clé exacte. `invalidate({ prefix: 'heatmap:plan:1:' })` cible un groupe en respectant la limite du segment. `clear()` couvre toutes les clés. Ces opérations retirent les valeurs et détachent les requêtes concernées. Un `set` explicite remplace aussi le contenu et la requête de sa clé, même si l’admission échoue.

`getOrFetch` partage le loader et le TTL de l’appel qui démarre la requête. `forceRefresh` remplace une entrée ou un loader ordinaire en cours. Les appels suivants peuvent rejoindre le loader forcé courant. L’identité de la requête protège l’admission et le nettoyage contre les résolutions dans le désordre. Le résultat expose `{ value, isCurrent() }`. Vérifier `isCurrent()` au moment de publier la donnée. Le journal borné à 128 opérations signale aussi l’invalidation après résolution, y compris pour une valeur non admise, expirée ou évincée. Un résultat dont la révision précède l’historique disponible est considéré obsolète par prudence.

Un `AbortSignal` annule l’attente individuelle avec `signal.reason`. Le loader partagé continue, y compris après le départ du dernier consommateur. Le loader doit utiliser son propre signal si un délai réseau est nécessaire. Un loader en échec rejette les appels joints et libère sa place. Les loaders détachés restent comptés jusqu’à leur résolution ou leur rejet. La limite par défaut de 100 loaders actifs, configurable avec `maxInFlightRequests`, rejette tout nouveau loader au-delà du plafond.

- `hits` et `misses` comptent les lectures `get` et `getOrFetch`. Les accès forcés, dédupliqués et refusés faute de capacité sont des misses. Un signal déjà annulé ne compte pas. `has` actualise le LRU sans incrémenter ces compteurs. `hitRate` est la fraction de hits parmi ces lectures, ou 0 sans lecture.
- `coalescedRequests` compte les appels qui rejoignent un loader. `evictions` compte les retraits LRU liés aux limites. `expirations` compte les retraits au contrôle du TTL. `invalidations` compte les clés distinctes retirées ou détachées par invalidation explicite, vidage ou actualisation forcée. Une entrée expirée encore présente lors de l’invalidation relève de ce dernier compteur.
- `rejectedEntries` compte les admissions refusées. `staleResultsDiscarded` compte les loaders détachés qui aboutissent avec succès et dont la valeur est écartée du stockage. `entries` et `estimatedSizeBytes` mesurent le stockage après purge. `inFlightRequests` compte les loaders démarrés qui restent actifs, détachés compris. `resetStats()` remet les compteurs cumulés à zéro.

Depuis `frontend`, `npm test`, `npm run build` et le lint ciblé passent. Les 19 tests du moteur utilisent une horloge injectable et des promesses pilotées explicitement. Le lint global reproduit les quatre erreurs `react-hooks/set-state-in-effect` mesurées avant la phase dans `SettingsPage.tsx` (85 et 183), `SimulatorControls.tsx` (42) et `useApPositions.ts` (12).

En phase 5B, choisir les GET à mettre en cache, normaliser leurs clés et filtres, raccorder les invalidations aux mutations API réussies et utiliser `isCurrent()` avant publication dans les hooks React. Couvrir les parcours intégrés de lecture, mutation et actualisation.

## Phase 5B · Intégration du cache API frontend

`api.ts` passe les GET autorisés par `ApiRead` et `apiCache.getOrFetch()`. Le cache accepte les corps HTTP réussis qui déclarent du JSON, se décodent et respectent la forme attendue à l’entrée de la couche API. Le moteur 5A conserve ses plafonds de 100 entrées, 16 Mio au total, 2 Mio par entrée et 100 loaders simultanés. Les statuts serveur et iperf, les scans live, les mutations, les téléchargements et les exports restent hors cache.

- **30 s** pour `listPlans`, `getPlan` et `getScanDetail`.
- **15 s** pour `listAccessPoints`, `listPolygons`, `listScanPoints`, `getHistory`, `getHeatmap`, `getHeatmapSpeed`, `getHeatmapGateway`, `getNetworks`, `listBssidRules`, `listSeenBssids`, `getSettings`, `listApMappings`, `fetchApPositions` et `listSimulationScenarios`. La fonction gateway est conservée pour compatibilité. Le backend de cette branche ne publie pas cette route, donc sa réponse 404 reste hors cache.

La bibliothèque représente un survey par un plan et réutilise ses GET. Le frontend ne consomme aucun GET de la famille backend `/surveys/:id`. L’historique et les heatmaps de plan incluent les mesures des surveys rattachés. Aucun identifiant de survey ne sert de clé de plan pour une route de survey. Les clés commencent par `api:<VITE_API_BASE>:`, suivies de segments comme `plans:all`, `plan:ID:detail`, `history:plan:ID:all` et `heatmap:plan:ID:FILTRES`. Chaque segment est encodé avec `encodeURIComponent`. Les groupes se terminent par `:`. Le frontend utilise une base par build et les identifiants d’accès implicites de même origine. Il ne sélectionne pas plusieurs sessions API dans une page. Les détails de scans utilisent la portée plan/point quand le consommateur la connaît et une famille distincte sinon. Les filtres RSSI utilisent la query dans un ordre fixe. Le BSSID est mis en minuscules comme dans le backend. Une chaîne vide ou `connected=false` équivaut à l’absence du filtre correspondant. Le SSID conserve sa casse et ses espaces.

### Invalidation locale

- **Nouveau scan**. Historique, variantes RSSI, réseaux, débit et gateway du plan identifié par le point, plus les BSSID vus. Les mêmes familles sont invalidées sur tous les plans si le plan est inconnu à réception du statut HTTP.
- **Points**. Création et modification de note invalident les points et l’historique. L’activation invalide aussi le RSSI, le débit et gateway. Une suppression ajoute les réseaux, les BSSID vus et les détails du point qui peuvent disparaître en cascade. Les détails sans portée déclarée sont invalidés par prudence.
- **Plans**. Un téléversement invalide la liste. Renommage et calibration invalident aussi le détail. Une suppression ajoute les mesures, points, AP, polygones, mappings, positions et scénarios du plan, les détails de scans du plan et sans portée déclarée, ainsi que les BSSID vus.
- **AP, polygones, mappings et positions**. Chaque écriture invalide la famille du plan. La suppression d’un AP invalide aussi les scénarios liés. Pour les mutations adressées par ID dont le plan n’est pas connu, l’invalidation couvre la famille sur tous les plans.
- **Règles BSSID**. Règles, BSSID vus, historiques, RSSI, réseaux et détails de scans sur tous les plans. L’analyse des canaux est reconstruite à partir de l’historique et des détails invalidés.
- **Réglages et simulations**. La modification d’un réglage invalide les réglages, y compris la source des couleurs de heatmap. Une écriture de scénario invalide la liste du plan concerné, ou la famille si le plan est inconnu.
- **Imports ZIP et CSV**. Vidage global sur toute issue de l’écriture, y compris un CSV partiellement appliqué. La prévisualisation garde le cache courant.

L’invalidation commence dès le succès HTTP et précède le décodage du corps. Les erreurs réseau, HTTP 408 et 5xx déclenchent l’invalidation de la même portée, et les imports invalident aussi en cas d’autres statuts d’erreur. La mutation est envoyée une seule fois. Une perte de connexion peut précéder la fin de l’écriture serveur, ce qui rend son résultat final incertain.

### Publication dans React

`useApiQuery` annule l’attente du consommateur précédent lors d’un changement de plan, de filtre ou d’un démontage. Chaque chargement retient les garanties `isCurrent()` de ses lectures, ainsi qu’une garantie de révision pour les erreurs. La vérification précède la publication du résultat composé. Une invalidation correspondante coupe immédiatement l’attente en cours puis programme une seule relecture pour les invalidations reçues dans la même tâche. Les relectures forcées contournent les valeurs stockées et utilisent le mode HTTP `reload`. Les requêtes normales utilisent `no-cache` pour revalider auprès du serveur. Chaque loader partagé a son propre signal de 30 s, qui couvre le téléchargement et le décodage du corps. Le désabonnement d’un consommateur laisse le loader partagé terminer.

Hooks intégrés. `useSurveysLibrary`, `useChannelAnalysis`, `usePlanStore`, `useScanStore`, `usePlanImage`, `useApPositions` et `useHeatmapColours`. Les pages Heatmap, Scan, Relevés, Bibliothèque, Paramètres et Simulation, ainsi que la table des points, vérifient leurs chargements via le même hook. La table de la bibliothèque réutilise l’historique et le RSSI déjà chargés pour ses cartes. L’analyse des canaux et la table des points dédupliquent les identifiants de scans avant de charger les détails.

### Validation et activation

Depuis `frontend`, `npm test`, `npm run build` et le lint ciblé passent. Les 16 nouveaux tests vérifient les contenus et les appels HTTP avec des réponses simulées. Le lint global conserve l’erreur préexistante `react-hooks/set-state-in-effect` dans `SimulatorControls.tsx:42`. Les trois autres erreurs de référence ont disparu dans le code des lectures modifiées.

Le scénario React de [apiRead.browser.html](frontend/tests/apiRead.browser.html), ouvert via Vite dans Chromium, passe avec 9 GET et 1 POST. Il couvre les changements rapides de plan et de BSSID, les réponses et erreurs dans le désordre, la réactualisation après une mutation, l’actualisation forcée et le démontage. Le parcours simulé avec deux consommateurs simultanés de A, puis B, puis un retour à A, donne 6 GET avec déduplication seule et 4 GET avec stockage activé, pour 8 GET sans les deux optimisations. Ouvrir la table des points depuis une carte de la bibliothèque réutilise deux lectures déjà réalisées, puis demande les détails de scans nécessaires.

Le stockage est désactivé par défaut. Pour un test, démarrer Vite ou reconstruire le frontend avec `VITE_API_CACHE_ENABLED=true`. La déduplication, l’invalidation et les contrôles de publication restent actifs lorsque le stockage est désactivé. Le cache et ses notifications restent dans le même contexte JavaScript.

En phase 5C, mesurer le coût et les gains sur les parcours complets, vérifier la cohérence des données visibles entre PC et smartphone, et valider le comportement du HTTPS, du cache HTTP, des délais et des TTL sur les appareils cibles avant de décider de l’activation du stockage par défaut.

## Phase 5C · Synchronisation des lectures API

`GET /api/v1/revision` renvoie en mémoire `{ instanceId, revision }` avec `Cache-Control: no-store`. Chaque processus crée son identifiant au démarrage. La révision augmente après un commit SQLite ou un changement en autocommit. Le proxy Vite transmet cette route et la limite API habituelle s’applique.

`runDataWrite` couvre l’autocommit pour les plans, surveys, points de mesure, tests de débit, AP, polygones, mappings et positions d’AP, règles BSSID, paramètres et scénarios de simulation. `commitDataTransaction` notifie au retour des transactions de scan et d’import ZIP. Les savepoints attendent le commit de la transaction extérieure. Le CSV conserve son comportement partiel et notifie chaque écriture validée, y compris si la suite échoue. Une future transaction d’écriture doit utiliser ce helper à sa frontière de commit. La route et la table de simulation sont absentes du montage et du schéma de cette branche. Les quatre méthodes d’écriture du dépôt ont été testées avec une table temporaire.

`apiSync.ts` effectue une vérification initiale avant les lectures suivies, puis interroge la révision toutes les 5 s tant que le document est visible et en ligne. Une seule requête est active. Le retour au premier plan et la reconnexion déclenchent une vérification, sous réserve de `Retry-After`. Le délai de la requête et de la lecture de son corps est de 3 s. Après un échec, le backoff progresse de 5 à 60 s. Les listeners et les timers sont libérés à l’arrêt.

Une nouvelle instance ou une variation de révision invalide les lectures via `invalidateApiReads('all')`. Les consommateurs actifs relisent leurs données et `ApiRead.isCurrent()` empêche la publication des anciens résultats. Le reçu CORS `X-Heatmap-Revision` identifie seulement une plage contiguë appartenant à la requête d’écriture. Le frontend évite une relecture globale si ses invalidations locales réussies couvrent intégralement cette plage depuis la dernière révision observée. Les suppressions de plans et de points gardent la vérification globale pour les cascades croisées des anciennes données. Une erreur de vérification purge le stockage et la déduplication reste disponible. La récupération valide de nouveau les lectures avant la reprise du stockage.

La cohérence est éventuelle. Le délai dépend du prochain poll, du réseau, des lectures et du rendu. Le mécanisme suppose un backend mono-processus et couvre les écritures effectuées par ses chemins applicatifs. Les modifications externes du fichier SQLite et les écritures d’autres processus n’augmentent pas sa révision. Le cache raster de la phase 3 reste indexé sur les entrées de calcul et peut servir après une invalidation API.

Le stockage API reste désactivé par défaut, avec activation explicite via `VITE_API_CACHE_ENABLED=true` et désactivation via `VITE_API_CACHE_ENABLED=false`. Le polling reste actif dans les deux cas. `VITE_API_SYNC_INTERVAL_MS` accepte un intervalle d’au moins 1 000 ms et utilise 5 000 ms par défaut. Les plafonds restent à 100 entrées, 16 Mio estimés et 2 Mio par entrée. Les TTL restent à 15 et 30 s.

Les 105 tests backend passent avec le cache activé puis désactivé. Les 230 tests frontend, le build et le lint ciblé passent. Le lint global signale uniquement l’erreur préexistante `react-hooks/set-state-in-effect` dans `SimulatorControls.tsx:42`. Le test navigateur de la phase 5B passe, ainsi que les vérifications sur deux contextes Chromium indépendants.

Le stockage avec synchronisation fait passer les requêtes HTTP de 555 à 230 (−58,6 %), dont 20 polls, et les réponses de 1 011,3 Kio à 684,9 Kio (−32,3 %). Le délai distant après réponse d’écriture est de 3 781,0 ms p50 et 8 916,5 ms p95. Le stockage reste désactivé par défaut en attendant l’intégration Git du cache raster des phases 2 et 3 et la validation sur les appareils cibles. [Rapport et reproduction](benchmarks/phase5c-report.md)

### Essai manuel sur PC et smartphone

1. Utiliser un backend de test et un plan de test accessibles aux deux appareils via le proxy ou l’URL HTTPS habituelle. Pour tester le stockage, construire le frontend avec `VITE_API_CACHE_ENABLED=true`.
2. Ouvrir Couverture sur le PC et sélectionner le même plan dans Relevé Wi-Fi sur le smartphone. Garder la page du PC visible. Enregistrer puis conserver un relevé à un nouveau point sur le smartphone. Relever le délai jusqu’à l’ajout du point et à l’actualisation de la couverture sur le PC.
3. Renommer une règle BSSID, supprimer un point puis modifier une zone depuis le second appareil. Vérifier le libellé, le retrait du point et la nouvelle couverture sur le premier appareil. Dans l’onglet Réseau, contrôler le `200` et `Cache-Control: no-store` de la révision.
4. Masquer la page du PC pendant une modification, revenir au premier plan, puis répéter après une coupure réseau. Vérifier la reprise automatique. Redémarrer le backend temporaire et vérifier que le nouvel `instanceId` provoque une relecture.

### Suite après la phase 6

Rejouer la checklist du rapport sur les appareils physiques et via le proxy HTTPS cible avant de réévaluer le stockage API par défaut.
