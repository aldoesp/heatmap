# Heatmap · Phase 5C

Le benchmark utilise Chromium headless et le build Vite de l’application. Chaque série lance des contextes vierges. Les trois modes parcourent le même serveur Express et le même fixture SQLite, réinitialisé entre les parcours. Le mode direct contourne le cache API uniquement dans le build du benchmark. Les parcours sans synchronisation servent de témoins. Le frontend livré continue de synchroniser les données lorsque le stockage est désactivé.

## Reproduction

Depuis `frontend`, exécuter `node benchmarks/phase5c.mjs`. Le script lance le backend en mode scan déterministe, le proxy Vite et Chromium sur loopback. Il crée la base, les fichiers du build et le profil Chromium sous un répertoire temporaire qu’il retire en fin d’exécution. `CHROMIUM` permet de choisir l’exécutable. `PHASE5C_RUNS=1` lance une série de vérification. Un premier argument permet de choisir le fichier JSON de sortie.

Le cache raster des phases 2 et 3 doit être présent. Les scénarios contrôlent les pixels du raster Leaflet affiché par l’application et comptent les messages de calcul envoyés au worker. Le plan de 480 × 320 contient douze points et trois radios par point. Deux plans sont utilisés. Le relevé réseau utilise la fixture du backend avec le ping désactivé. Les deux contextes sont indépendants dans la même instance Chromium.

Les durées sont mesurées de l’action jusqu’à l’affichage du contenu attendu. Le premier chargement comprend les ressources du frontend et le premier raster. La navigation vérifie l’image chargée, la campagne vérifie le nombre de scans et l’ouverture des détails vérifie le contenu des observations. Les percentiles utilisent le rang supérieur. Les octets comptabilisent les réponses HTTP encodées vues par Chromium pour `/api/v1`, en-têtes inclus. Les ressources statiques, les octets montants et le trafic de l’autre contexte sont hors des compteurs présentés. Les parcours courants et l’actualisation distante ont des compteurs distincts dans le JSON.

Mesures sur Intel(R) Core(TM) i5-7200U CPU @ 2.50GHz, Chrome/156.0.8078.79, Node v24.22.2 et une fenêtre de 1360x880. Le profil Wi-Fi simulé ajoute 45 ms de latence et limite les débits descendant et montant à 12 et 4 Mbit/s. Le cache backend est actif. Les répétitions partagent l’IP loopback. Pour éviter de saturer cette IP, le backend temporaire accepte 10 000 appels API et 2 000 scans par minute.

## Durées

Durées p50 / p95 en millisecondes. Les trois paires suivent l’ordre direct, déduplication seule, puis déduplication avec stockage et synchronisation.

- Premier chargement (5 mesures par mode) · 2 576,5 / 8 050,3, 7 310,3 / 10 668,4, 2 294,8 / 8 801,7.
- Navigation entre plans (20 mesures par mode) · 1 075,6 / 3 876,4, 1 789,8 / 4 799,0, 1 370,8 / 4 142,6.
- Parcours BSSID A → B → C → A (20 mesures par mode) · 1 465,7 / 3 546,0, 1 576,8 / 5 010,7, 1 088,0 / 4 864,7.
- Bibliothèque des surveys (10 mesures par mode) · 486,6 / 1 260,9, 483,1 / 945,6, 388,9 / 833,4.
- Analyse des canaux (10 mesures par mode) · 646,0 / 1 451,4, 699,1 / 966,5, 315,1 / 582,2.
- Détails de scans (10 mesures par mode) · 652,8 / 1 181,4, 457,1 / 870,4, 204,7 / 708,8.
- Relevés RSSI (10 mesures par mode) · 265,6 / 459,9, 254,5 / 435,2, 208,5 / 565,7.

Le premier chargement varie fortement entre les cinq répétitions à froid, y compris entre les deux modes sans stockage. Le p95 des relevés RSSI augmente de 130,5 ms par rapport à la déduplication seule. Ces petits échantillons ne permettent pas d’isoler le coût du polling dans ces deux parcours.

## Réseau, cache et raster

- **Direct** · 555 requêtes métier + 0 polls = 555 HTTP. 1 011,1 Kio métier + 0,0 Kio de polling = 1 011,1 Kio. 0 hits, 0 requêtes dédupliquées, 0,0 Kio au maximum des fins de parcours et 45 calculs raster.
- **Déduplication seule** · 555 requêtes métier + 0 polls = 555 HTTP. 1 011,3 Kio métier + 0,0 Kio de polling = 1 011,3 Kio. 0 hits, 0 requêtes dédupliquées, 0,0 Kio au maximum des fins de parcours et 45 calculs raster.
- **Stockage et synchronisation** · 210 requêtes métier + 20 polls = 230 HTTP. 662,6 Kio métier + 22,3 Kio de polling = 684,9 Kio. 345 hits, 0 requêtes dédupliquées, 38,0 Kio au maximum des fins de parcours et 45 calculs raster.

Le stockage atteint **64,5 % de hits**. Face à la déduplication seule, le total HTTP, polls inclus, recule de **58,6 %** et le volume des réponses de **32,3 %**. Un poll représente en moyenne 1 141 octets réponse, soit environ 13,4 Kio par minute et par onglet visible à 5 s. Les parcours mesurés lancent peu de lectures simultanées de la même clé. Le test React contrôlé exerce la déduplication.

## Actualisation distante

Chromium a rendu **5 / 5** nouvelles mesures sans rechargement. Le délai entre la réception de la réponse d’écriture dans B et l’affichage dans A est de **3 781,0 ms p50 / 8 916,5 ms p95**. De l’envoi de la création du point à l’affichage, les délais vont de 3 142,4 à 9 111,9 ms. Les témoins sans synchronisation ont chacun conservé la heatmap précédente durant 5,3 s.

Les 5 actualisations ont produit 35 relectures métier et 5 polls, soit 40 requêtes et 138,7 Kio. Chaque nouveau relevé a déclenché un seul calcul raster. Un scénario a aussi vérifié l’alias BSSID et son raster identique, le retour aux pixels de départ après la suppression du point, puis le changement de pixels provoqué par le polygone. La vérification de l’alias a déclenché zéro calcul raster.

## Décision

Le stockage reste désactivé par défaut. Les mesures favorisent les consultations répétées, mais la validation raster s’appuie sur les changements des phases 2 et 3 encore présents dans l’arbre de travail. Le déploiement doit aussi être vérifié sur PC et smartphone avec le proxy HTTPS cible. La déduplication et la synchronisation restent actives par défaut. [Mesures brutes](phase5c-frontend.json)
