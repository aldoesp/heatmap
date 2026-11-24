# Performance Heatmap

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
