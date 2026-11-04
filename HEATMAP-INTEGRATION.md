# Intégration du calcul de couverture régularisé

Branche de travail : `heatmap-regularized`.

## Utilisation

Dans la carte RSSI, le sélecteur **Calcul** propose **Régularisé** par défaut et **Hybride existant** pour comparer. Les points indiquent les mesures brutes. Le fond est une estimation régularisée : il ne passe volontairement pas par chaque mesure. La trame distingue les extrapolations des zones soutenues par le maillage. Les isolignes correspondent à −85, −75, −67 et −55 dBm. L’opacité se règle sans recalculer le raster et la sonde utilise la même fonction de calcul que la carte.

Choisir un SSID et une bande pour examiner son réseau. Sans filtre, le fond représente le meilleur signal parmi les radios disponibles, y compris les autres réseaux. Le filtre « connecté » est désactivé initialement pour permettre l’affichage des imports sans marqueur de connexion.

## Calcul

- Ajustement indépendant par plan, relevé, BSSID, bande, fréquence et polygone ; répétitions au même emplacement agrégées par médiane.
- Spline radiale `thin_plate_spline`, terme affine, coordonnées divisées par la largeur du plan et régularisation λ = 1, comme dans la comparaison fournie.
- Valeurs limitées à l’intervalle observé pour chaque groupe. Repli IDW local sur quatre voisins pour les groupes isolés ou colinéaires.
- Masquage au-delà du percentile 90 des distances au plus proche point de la zone ; une zone sans données reste transparente. Aucun signal ne traverse les limites des polygones.
- Sélection du meilleur signal après estimation séparée des radios admissibles. Les positions supposées des AP ne sont pas nécessaires.

La régularisation λ = 1 est celle retenue pour l’exemple analysé ; son bénéfice ne constitue pas une garantie sur chaque futur relevé. La distance d’appui et le maillage décrivent le support spatial, pas une probabilité de précision. Les polygones limitent le calcul, sans modéliser l’atténuation physique des murs. Les grands relevés nécessiteront un calcul déporté ou un traitement dans un worker : l’ajustement dense et le rendu restent synchrones.

## Validation

- `cd frontend && npm test` : 130 tests réussis, dont référence numérique SciPy, groupes radio, zones, données manquantes et rendu.
- `cd frontend && npm run build` : compilation TypeScript et build Vite réussis.
- ESLint sur les fichiers modifiés : réussi.
- Vérification de l’exemple importé, grille 512 × 319 : 51 700 pixels valides, aucun écart de masque avec la comparaison, écart numérique maximal inférieur à 0,000001 dBm.

Les données du relevé restent hors des fichiers intégrés. Aucune dépendance ni migration de base de données n’est ajoutée.

## Dépôt Kali

Les fichiers sont transférés et relus avec `kali-mcp`. Le plugin disponible expose uniquement des opérations de fichiers ; il ne fournit pas de terminal. Les tests ci-dessus ont été exécutés dans la copie de préparation, sur la même base de code. Le commit et le push du dépôt Kali doivent être effectués depuis son terminal après examen des changements ; cette intégration ne prétend pas les avoir exécutés.
