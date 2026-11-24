# Plan : UX Paramètres — section BSSID + éditeur de couleurs visuel

## Contexte
La branche `feature/ui-ux-redesign` contient déjà une refonte partielle de
`SettingsPage.tsx` (sidebar de catégories + recherche + sections masquées/affichées).
Deux soucis d'UX restent à résoudre :

1. **Section BSSID** : un fragment mal indenté rassemble deux listes distinctes
   (BSSID capturés cases à cocher, règles configurées) et le formulaire d'ajout.
   Charge cognitive forte, pas de séparation visuelle.
2. **Éditeur de couleurs** : grille 5 colonnes crampée (position 0-1, picker
   couleur, opacité, libellé RSSI, supprimer). Aucune interaction visuelle :
   on ne peut pas ajouter un stop en cliquant/glissant dans le dégradé.

Portée retenue : **BSSID + Couleurs** (mobile et états de sauvegarde exclus).

## Décisions prises
- **Sous-onglets BSSID** : remplacer la liste unique par deux onglets
  « Règles configurées » (actuel) / « Captures récentes » (actuelle liste des
  `seenBssids`). Le bouton « Ajouter à la liste noire » reste disponible dans
  l'onglet Captures. Le formulaire d'ajout (nom + MAC + case liste noire) reste
  en bas de la section.
- **Éditeur de couleurs visuel** : remplacer la grille par un dégradé
  cliquable + glissable. Cliquer dans la barre ajoute un stop à cette position ;
  glisser un stop le déplace. Les contrôles numériques (position, couleur,
  opacité) restent accessibles en mode avancé replié (bouton « Afficher les
  détails ») pour respecter l'accessibilité clavier.
- **Pas de changement de logique métier** : les appels API, les règles de
  validation BSSID (`BSSID_RE`), les hooks `useHeatmapColours`, `usePlanImage`
  et la structure `HeatmapColours`/`ColourStop` sont inchangés.

## Tâches

### 1. `SettingsPage.tsx` — sous-onglets BSSID
- Ajouter un état `bssidTab: 'rules' | 'seen'`.
- Remplacer le `<section>` BSSID par :
  - un sélecteur d'onglet (2 boutons, style cohérent avec le reste de l'UI).
  - l'onglet `rules` : liste des `mappings` (actuelle) + formulaire d'ajout.
  - l'onglet `seen` : liste des `seenBssids` avec cases à cocher +
    bouton « Ajouter à la liste noire » (comportement actuel).
- Supprimer le fragment `<>` mal indenté ; la section devient un seul
  `<section>` propre.

### 2. `SettingsPage.tsx` — éditeur de couleurs visuel
- Remplacer la grille de stops par :
  - une barre de dégradé cliquable (`onClick` → `addStopAt(position)`).
  - un repère glissable par stop (`onMouseDown`/`onMove`/`onMouseUp`).
  - un panneau replié par stop contenant les 3 inputs (position, couleur,
    opacité) + bouton Supprimer.
- `addStopAt(position)` : insère un stop à la position donnée, recalibre les
  positions des stops adjacents pour qu'ils restent ordonnés (0 ≤ p1 < p2 < … ≤ 1).
- `dragStop(index, delta)` : déplace la position d'un stop, bornée par les stops
  voisins.
- Garder les boutons « Ajouter un stop » et « Réinitialiser ».

### 3. Tests
- Aucun test unitaire requis pour cette UX (pas de logique métier modifiée).
- Vérification manuelle dans le navigateur (desktop) :
  - onglet BSSID bascule, ajout d'une règle, ajout d'un BSSID capturé à la
    liste noire ;
  - éditeur de couleurs : clic dans le dégradé ajoute un stop, glissement le
    déplace, suppression, réinitialisation.

## Validation
- `cd frontend && npm run lint` (ESLint ciblé sur `SettingsPage.tsx`).
- `cd frontend && npm run build` (TypeScript + Vite).
- `cd frontend && npm run test` (s'assurer qu'aucun test existant n'est cassé).

## Hors scope
- Mobile (ancres de section, sélecteur compact).
- États de sauvegarde (badge « Réglages modifiés »).
- Export CSV, mode scan, iperf3 : inchangés.

## Fichiers modifiés
- `frontend/src/components/settings/SettingsPage.tsx` (seul).

## Aucun commit.