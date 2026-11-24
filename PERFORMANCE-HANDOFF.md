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
