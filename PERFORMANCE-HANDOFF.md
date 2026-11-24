# Performance Heatmap

## Phase 4A · Moteur de cache mémoire backend

`backend/src/cache/memoryCache.js` exporte `createMemoryCache(options)` pour les instances indépendantes et `memoryCache` comme instance partagée dans le processus Node. Les limites par défaut sont de 300 entrées, 64 Mio au total, 8 Mio par entrée et 60 000 ms de TTL. L’horloge `now` est injectable. L’expiration est vérifiée à l’accès et les entrées expirées sont balayées avant une éviction. Le moteur fonctionne sans timer.

`set` renvoie un booléen. Un TTL omis ou `undefined` utilise la valeur par défaut. Un TTL nul, négatif ou invalide, une valeur `undefined` et une entrée hors budget sont refusés. Une écriture refusée retire aussi l’ancienne valeur de la même clé. `getOrSet` appelle un loader synchrone sur un miss, renvoie son résultat même s’il est refusé par le cache, et laisse remonter son exception sans la stocker.

Construire les clés en joignant avec `:` des segments encodés par `encodeURIComponent`. Par exemple, le préfixe `heatmap:plan:1:` cible le plan `1` sans sélectionner le plan `10`. Conserver le séparateur final lors de l’invalidation d’un groupe. `invalidate('')` cible toutes les entrées.

L’estimation tient compte de la clé, du coût de l’entrée et des données accessibles par les propriétés propres énumérables à clé chaîne des objets simples et tableaux. Elle inclut le buffer sous-jacent d’un `Buffer` et compte les références partagées et cycles une fois par entrée. Les types complexes et les accesseurs sont hors du format pris en charge. L’estimation se fait à l’écriture et reste approximative par rapport à la mémoire V8 et aux allocations natives. Les valeurs sont conservées par référence et doivent être traitées en lecture seule.

`get` et `getOrSet` comptent chacun un hit ou un miss. `has` promeut l’entrée ou retire l’entrée expirée sans modifier le taux de hits. `delete` retire une clé et compte une éventuelle expiration. `invalidate` et `clear` comptent le nombre d’entrées retirées, y compris les expirations encore présentes. `resetStats` remet les compteurs à zéro et conserve le contenu, sa taille et son ordre LRU. Les mesures instantanées de `stats()` incluent les entrées expirées qui attendent encore leur nettoyage.

Validation depuis `backend` avec `node --test tests/memoryCache.test.js` et `npm test`.
