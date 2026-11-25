# Phase 4D · Cache backend Heatmap

Les gains les plus nets apparaissent sur les lectures répétées. Sur le volume de référence, la heatmap plan passe de **3,999 ms à 0,022 ms** au repository et de **4,746 ms à 1,808 ms** en HTTP. Sur la charge élevée, le miss de cette lecture ajoute **5,229 ms** au repository par rapport au cache désactivé. L’écart négatif relevé au volume de référence indique que le bruit empêche d’isoler ce surcoût sur ce cas. [Mesures brutes](phase4d-backend.json)

## Reproduction et périmètre

Depuis la racine, lancer `npm --prefix backend run bench:phase4d`. Utiliser par exemple `-- --volume=reference --iterations=30 --warmup=5` pour limiter l’exécution. Les options `plans`, `pointsPerPlan`, `scansPerPoint`, `observationsPerScan`, `bssids`, `coldRuns`, `journeyRuns`, `mixedOperations`, `filterRounds` et `output` sont également configurables via `--nom=valeur`. Chaque volume s’exécute dans un processus séparé. Une copie temporaire du code backend dirige la résolution des fichiers image vers son répertoire temporaire. Les bases, instantanés et images temporaires sont supprimés en fin d’exécution.

| Volume | Plans | Surveys | Points | Scans | Observations | BSSID vus |
| --- | --- | --- | --- | --- | --- | --- |
| small | 2 | 2 | 90 | 90 | 1350 | 200 |
| reference | 20 | 20 | 600 | 600 | 9000 | 200 |
| high | 20 | 20 | 2000 | 6000 | 90000 | 200 |

La référence reprend le générateur des phases 0 et 1. La charge élevée utilise 20 plans de 100 points, trois scans par point et quinze observations par scan, avec la même distribution déterministe des bandes, des BSSID et des règles. Les écritures RSSI reprennent les 15 observations d’un scan. Le CSV couvre dix points avec quinze observations chacun. Le ZIP duplique une campagne du jeu testé avec son image.

Les lectures individuelles et les écritures utilisent cinq préchauffages et 30 itérations. Les parcours commencent après restauration d’un instantané par mode et comportent trois passes successives. Le premier passage peut remplir le cache pour le suivant. Toutes les durées sont en millisecondes. Le JSON donne le minimum, la moyenne, le p50, le p95 et le maximum, le nombre d’échantillons et la taille de réponse pour chaque lecture, ainsi que les compteurs. Les lectures vérifient le nombre attendu de hits et de misses et l’identité octet par octet des réponses JSON entre les modes. Les chronos de repository s’arrêtent avant la sérialisation. Les chronos HTTP incluent l’API et la lecture complète de la réponse sur loopback avec connexion persistante.

## Lectures sur la référence

Les colonnes P0 et P1 sont des repères historiques à connexion ouverte issus de leurs fichiers archivés. Les gains et les écarts miss–désactivé sont calculés uniquement entre modes 4D de la même exécution. La colonne Admission donne cet écart de médianes. Des valeurs négatives reflètent la variabilité entre blocs et ne permettent pas de conclure à une admission gratuite. Les runs historiques utilisent 15 échantillons et trois préchauffages et ne constituent pas une comparaison contrôlée avec 4D. Les tirets indiquent une métrique absente des relevés historiques. [Phase 0](phase0-backend.json) · [Phase 1](phase1-backend.json)

### Repositories · p50 en ms

| Lecture | P0 | P1 | 4D désactivé | 4D miss | 4D hit | Admission | Gain hit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BSSID vus | 587,878 | 15,634 | 18,857 | 19,515 | 0,008 | 0,658 | 100,0% |
| Historique plan | 4,320 | 0,838 | 2,148 | 1,287 | 0,008 | -0,861 | 99,6% |
| Historique survey | 4,174 | 0,853 | 1,141 | 1,296 | 0,007 | 0,155 | 99,4% |
| Heatmap plan | 1,709 | 1,753 | 3,999 | 2,872 | 0,022 | -1,127 | 99,4% |
| Heatmap survey | — | — | 2,080 | 4,170 | 0,051 | 2,090 | 97,5% |
| Réseaux plan | 1,136 | 1,055 | 1,375 | 1,662 | 0,006 | 0,287 | 99,6% |
| Réseaux survey | — | — | 1,812 | 2,559 | 0,016 | 0,747 | 99,1% |
| Débit plan | 0,100 | 0,107 | 0,259 | 0,286 | 0,019 | 0,027 | 92,7% |
| Débit survey | — | — | 0,165 | 0,163 | 0,006 | -0,002 | 96,4% |
| Analyse survey | 18,536 | 2,143 | 2,552 | 3,531 | 0,026 | 0,979 | 99,0% |

### HTTP · p50 en ms

| Lecture | P0 | P1 | 4D désactivé | 4D miss | 4D hit | Admission | Gain hit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BSSID vus | 548,181 | 15,725 | 26,658 | 28,222 | 1,117 | 1,564 | 95,8% |
| Historique plan | 5,552 | 1,857 | 2,517 | 4,021 | 2,158 | 1,504 | 14,3% |
| Historique survey | 5,377 | 1,748 | 2,159 | 2,938 | 1,329 | 0,779 | 38,4% |
| Heatmap plan | 3,342 | 3,104 | 4,746 | 4,297 | 1,808 | -0,449 | 61,9% |
| Heatmap survey | 20,954 | 3,068 | 4,194 | 5,462 | 2,035 | 1,268 | 51,5% |
| Réseaux plan | 2,666 | 2,169 | 2,602 | 4,474 | 2,130 | 1,872 | 18,1% |
| Réseaux survey | 21,029 | 2,046 | 4,018 | 3,389 | 1,097 | -0,629 | 72,7% |
| Débit plan | 0,970 | 0,905 | 1,865 | 2,025 | 0,893 | 0,160 | 52,1% |
| Débit survey | 0,989 | 0,885 | 1,017 | 1,029 | 1,016 | 0,012 | 0,1% |
| Analyse survey | — | — | 4,999 | 6,139 | 2,933 | 1,140 | 41,3% |

L’ouverture SQLite médiane du test heatmap plan de référence est de 1,740 ms. La première requête repository prend ensuite 2,117 ms. En HTTP, la même lecture prend 5,631 ms ouverture comprise. Le cache disque de l’OS reste en place. Un miss 4D est mesuré avec SQLite déjà ouvert.

## Parcours · p50 d’une passe en ms

La bibliothèque liste les plans, puis lit les surveys, l’historique, la heatmap et les mappings pour chaque plan. La navigation lit historique, heatmap, réseaux et débit sur un maximum de quatre plans avant de revenir au premier. La sélection BSSID suit A, B, C, A sur le premier plan. L’analyse est relue six fois. Les six clients utilisent des connexions séparées pour trois salves HTTP de six lectures alternant l’historique et la heatmap.

La campagne lit l’historique, le RSSI et les BSSID vus avant et après le scan, puis le débit et l’historique après le test de vitesse. Elle modifie ensuite une règle BSSID avant de relire RSSI, analyse et BSSID vus. Les mixtes espacent les écritures sur 60 opérations, avec une rotation scan, débit, règle et des lectures HTTP en rotation sur six routes. Les proportions sont des hypothèses synthétiques. Les taux de hits portent uniquement sur les lectures qui consultent le cache.

| Parcours | Volume | Désactivé | Activé | Gain | Hits / misses | Taux de hits |
| --- | --- | --- | --- | --- | --- | --- |
| Bibliothèque | small | 24,826 | 10,924 | 56,0% | 8 / 4 | 66,7% |
| Bibliothèque | reference | 229,474 | 145,780 | 36,5% | 80 / 40 | 66,7% |
| Bibliothèque | high | 1177,458 | 377,216 | 68,0% | 80 / 40 | 66,7% |
| Plans répétés | small | 44,469 | 41,133 | 7,5% | 28 / 8 | 77,8% |
| Plans répétés | reference | 51,805 | 22,780 | 56,0% | 44 / 16 | 73,3% |
| Plans répétés | high | 338,555 | 70,600 | 79,1% | 44 / 16 | 73,3% |
| BSSID A → B → C → A | small | 7,248 | 5,644 | 22,1% | 9 / 3 | 75,0% |
| BSSID A → B → C → A | reference | 7,623 | 3,106 | 59,3% | 9 / 3 | 75,0% |
| BSSID A → B → C → A | high | 14,011 | 5,270 | 62,4% | 9 / 3 | 75,0% |
| Analyse répétée | small | 48,503 | 20,178 | 58,4% | 17 / 1 | 94,4% |
| Analyse répétée | reference | 26,351 | 11,764 | 55,4% | 17 / 1 | 94,4% |
| Analyse répétée | high | 274,714 | 89,788 | 67,3% | 17 / 1 | 94,4% |
| Campagne de mesures | small | 73,795 | 61,473 | 16,7% | 4 / 29 | 12,1% |
| Campagne de mesures | reference | 91,579 | 67,974 | 25,8% | 4 / 29 | 12,1% |
| Campagne de mesures | high | 662,106 | 519,536 | 21,5% | 4 / 29 | 12,1% |
| Six clients HTTP | small | 100,258 | 38,226 | 61,9% | 52 / 2 | 96,3% |
| Six clients HTTP | reference | 53,566 | 23,060 | 57,0% | 52 / 2 | 96,3% |
| Six clients HTTP | high | 369,488 | 116,719 | 68,4% | 52 / 2 | 96,3% |
| Mixte 90/10 | small | 291,270 | 198,157 | 32,0% | 89 / 73 | 54,9% |
| Mixte 90/10 | reference | 313,381 | 201,816 | 35,6% | 89 / 73 | 54,9% |
| Mixte 90/10 | high | 2504,291 | 1331,289 | 46,8% | 89 / 73 | 54,9% |
| Mixte 70/30 | small | 240,599 | 254,755 | -5,9% | 5 / 121 | 4,0% |
| Mixte 70/30 | reference | 284,332 | 262,789 | 7,6% | 5 / 121 | 4,0% |
| Mixte 70/30 | high | 1602,754 | 2032,981 | -26,8% | 5 / 121 | 4,0% |
| Mixte 50/50 | small | 152,151 | 158,540 | -4,2% | 0 / 90 | 0,0% |
| Mixte 50/50 | reference | 107,501 | 115,854 | -7,8% | 0 / 90 | 0,0% |
| Mixte 50/50 | high | 534,460 | 693,472 | -29,8% | 0 / 90 | 0,0% |

À 90 000 observations, le mixte 90/10 passe de 2 504 à 1 331 ms par passe avec 54,9 % de hits. Les mixtes 70/30 et 50/50 ralentissent respectivement de 26,8 % et 29,8 %, avec 4 % et 0 % de hits. Ces écarts décrivent les ordres synthétiques testés.

## Écritures · p50 en ms

La mesure inclut le SQL du repository, la recherche des périmètres et l’éviction. Les imports incluent le service complet et le ZIP inclut sa validation et les écritures de fichiers. Les suppressions sont mesurées au repository, avec les cascades SQLite. Le temps HTTP et la suppression d’image propre au contrôleur plan sont hors de ces mesures. Chaque essai restaure le même instantané hors chronomètre, puis effectue les mêmes lectures dans les deux modes. Les hooks d’invalidation restent appelés avec le cache désactivé. Ils résolvent toujours leurs périmètres et travaillent alors sur un cache vide.

| Écriture | Volume | Désactivé | Activé | Écart | Entrées invalidées |
| --- | --- | --- | --- | --- | --- |
| Scan RSSI | small | 0,843 | 0,858 | 0,015 | 8 |
| Scan RSSI | reference | 1,198 | 0,993 | -0,205 | 8 |
| Scan RSSI | high | 0,910 | 0,983 | 0,073 | 8 |
| Test de débit | small | 0,337 | 0,346 | 0,009 | 4 |
| Test de débit | reference | 0,313 | 0,324 | 0,011 | 4 |
| Test de débit | high | 0,342 | 0,366 | 0,024 | 4 |
| Désactivation point | small | 0,270 | 0,266 | -0,004 | 7 |
| Désactivation point | reference | 0,232 | 0,253 | 0,021 | 7 |
| Désactivation point | high | 0,251 | 0,257 | 0,006 | 7 |
| Suppression point | small | 0,490 | 0,497 | 0,007 | 10 |
| Suppression point | reference | 0,598 | 0,600 | 0,002 | 10 |
| Suppression point | high | 1,066 | 1,123 | 0,057 | 10 |
| Suppression survey | small | 2,561 | 2,667 | 0,106 | 10 |
| Suppression survey | reference | 2,974 | 3,035 | 0,061 | 10 |
| Suppression survey | high | 22,968 | 22,213 | -0,755 | 10 |
| Suppression plan | small | 3,029 | 2,943 | -0,086 | 10 |
| Suppression plan | reference | 3,534 | 3,532 | -0,002 | 10 |
| Suppression plan | high | 26,394 | 27,966 | 1,572 | 10 |
| Règle BSSID | small | 0,230 | 0,250 | 0,020 | 8 |
| Règle BSSID | reference | 0,249 | 0,246 | -0,003 | 8 |
| Règle BSSID | high | 0,235 | 0,248 | 0,013 | 8 |
| Import CSV | small | 10,844 | 11,596 | 0,752 | 1 |
| Import CSV | reference | 13,058 | 12,421 | -0,637 | 1 |
| Import CSV | high | 14,891 | 14,953 | 0,062 | 1 |
| Import ZIP | small | 17,428 | 16,687 | -0,741 | 10 |
| Import ZIP | reference | 14,373 | 14,290 | -0,083 | 10 |
| Import ZIP | high | 120,986 | 120,219 | -0,767 | 10 |

La différence entre modes estime le coût incrémental d’éviction avec ces entrées préchauffées. Elle ne mesure pas le coût complet des hooks, commun aux deux modes. Les écarts faibles ou négatifs peuvent refléter le bruit de mesure.

## Mémoire · Mio

Chaque tour charge les heatmaps non filtrées de tous les plans et surveys, puis 360 combinaisons de filtres distinctes ou récurrentes. Les filtres SSID/bande donnent des résultats réels. Les BSSID fictifs ajoutent des réponses vides afin de solliciter aussi la limite d’entrées. Les compteurs sont cumulés. Le JSON fournit en plus `external`, `arrayBuffers`, les mesures avant GC et le point de départ.

| Volume | Tour | Entrées | Estimé avant filtres | Estimé fin | Heap après GC | RSS après GC | Évictions | Expirations | Rejets |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| small | 1 | 284 | 1,51 | 1,66 | 14,90 | 394,41 | 0 | 0 | 0 |
| small | 2 | 300 | 1,66 | 1,73 | 14,97 | 394,41 | 264 | 0 | 0 |
| small | 3 | 300 | 1,73 | 1,71 | 14,76 | 394,41 | 544 | 0 | 0 |
| reference | 1 | 300 | 10,01 | 0,52 | 14,29 | 395,61 | 100 | 0 | 0 |
| reference | 2 | 300 | 10,46 | 0,56 | 14,31 | 395,61 | 500 | 0 | 0 |
| reference | 3 | 300 | 10,50 | 0,52 | 14,13 | 395,61 | 900 | 0 | 0 |
| high | 1 | 300 | 62,81 | 4,46 | 16,46 | 451,38 | 100 | 0 | 0 |
| high | 2 | 300 | 62,81 | 5,01 | 16,75 | 451,27 | 500 | 0 | 0 |
| high | 3 | 300 | 62,81 | 4,46 | 16,28 | 451,30 | 900 | 0 | 0 |

En charge élevée, les entrées non filtrées montent à 62,81 Mio estimés. En fin de tour filtre, les 300 entrées occupent 4,46 à 5,01 Mio estimés, avec un RSS après GC proche de 451 Mio sur les trois tours.

Le test contrôlé du moteur vérifie l’éviction à 64 Mio, le refus d’une entrée atteignant 8 Mio avant surcoût de clé, et l’expiration à 60 000 ms. Les parcours applicatifs restent limités à 300 entrées. La taille estimée du cache, le heap et le RSS mesurent des choses différentes. Un RSS persistant après GC peut refléter la rétention des pages par l’allocateur ou SQLite et ne démontre pas une fuite.

## Validation et recommandations

Les deux suites `npm test` passent avec 101 tests, cache activé et désactivé. Elles ont été lancées dans une copie temporaire du backend pour isoler aussi les images de test. Les tests 4C couvrent les variantes RSSI, les règles BSSID, les cascades, la fusion ZIP, le CSV partiel, les erreurs d’écriture et les rollbacks imbriqués. Le benchmark compare aussi les lectures après écriture au résultat direct dans une transaction, et compare les réponses HTTP après les parcours avec mutations sur le même état SQLite.

Conserver les limites de 300 entrées, 64 Mio, 8 Mio par entrée et le TTL de 60 secondes. Le test d’expiration utilise une horloge déterministe. Il n’estime pas la fréquence d’expiration d’une session réelle. Une lecture à forte réutilisation ou un résultat SQL coûteux bénéficie du cache. Les petites lectures de débit et les variantes consultées une seule fois sont moins rentables, car le coût HTTP ou l’admission représentent une plus grande part du temps total. Les parcours avec invalidations rapprochées peuvent réduire fortement le bénéfice. Les valeurs observées sur les mixtes sont préférables aux gains d’un hit isolé pour apprécier ce cas. Le cache reste local au processus.
