# Passation — Refonte UX/UI WiFi Heatmapper
Mise à jour : 2026-11-16
Statut : conception et audit UX/UI réalisés ; implémentation dans l'application à démarrer DANS UNE NOUVELLE CONVERSATION.
IMPORTANT : ce document n'atteste d'aucune modification de code ni de validation des maquettes dans Figma.

## Objectif
Améliorer directement l'application existante WiFi Heatmapper en React + TypeScript + Vite, avec backend, sur Kali Linux.
Conserver les fonctionnalités métier, les données de mesures RSSI, les exports, le calcul/interpolation et l'identité dark mode avec accent vert. Ne pas remplacer le projet par un prototype.
Un seul utilisateur principal. Usage desktop : visualisation et analyse ; usage mobile : collecte RSSI dans l'application web et consultation heatmaps/résultats, téléphone connecté au serveur local via Wi-Fi.

## Problèmes rapportés/observés
- Scan : plan trop petit ou mal positionné, beaucoup d'espace perdu ; points de mesure noirs se chevauchent ; commandes éloignées du plan. Ces trois problèmes ont été vus dans une capture Figma (premier écran) et/ou rapportés.
- Performance : interface ressentie lente ; diagnostiquer les vraies causes avant de modifier les calculs. Le projet utilise un worker pour certains calculs.
- Heatmap, bouton « Exporter plusieurs BSSID » : options et présentation jugées confuses. Simplifier sans supprimer la sélection multiple, le choix de zone, le ZIP, ni les états annulation/erreur/progression.
- Paramètres : réglages difficiles à trouver ; trop d'options simultanées ; disposition et esthétique gênantes.
- Mobile : prévoir une vraie ergonomie tactile (plan/points/scan) et pas seulement une réduction du desktop.
- Upload et Surveys : déjà fonctionnels mais à optimiser de manière ciblée, sans supprimer leurs fonctionnalités ; Analyse reste à auditer/traiter.
- Identité : conserver l'apparence sombre actuelle et l'accent vert, mais améliorer organisation, hiérarchie, espacement et accessibilité.

## Décisions UX/UI déjà discutées
1. Priorité initiale : refonte du parcours Exporter plusieurs, puis Paramètres, puis Scan ; parallèlement résoudre les problèmes mobiles et la lisibilité/performance. Il faudra valider la proposition réelle dans le navigateur.
2. Export multiple : réduire la surcharge cognitive. Distinguer choix rapides et avancés si utile, récapitulatif clair des BSSID, zone(s) et ZIP ; progression, annulation, erreurs. Attention : le composant actuel BatchExportPanel.tsx propose zone « full » ou « visible » ; NE PAS inventer de combinaison ni changer la signature de l'API sans vérifier l'implémentation et en discuter.
3. Paramètres : navigation par catégories, recherche/repérage des réglages, options avancées repliées ; préserver mode scan, iperf3, règles BSSID / blacklist, éditeur de couleurs de heatmap, export.
4. Scan : mieux occuper la surface de travail, limiter visuellement le chevauchement des points, commandes proches de la carte, interactions tactiles précises et feedback d'enregistrement.
5. Desktop ET mobile : concevoir/tester les deux ; desktop analyse avancée, smartphone collecte et consultation.
6. Préserver la logique métier / les exports / le backend / les relevés / l'interpolation et la compatibilité des parcours existants.
7. Il existe des prototypes HTML interactifs V1/V2 discutés dans la conversation d'origine, non intégrés au code de production et non importés directement dans Figma.

## Structure du projet / accès techniques confirmés
Le MCP Kali est connecté, ping OK ; sa racine de partage donne accès à « frontend », « backend », « .kilo », « .freebuff », « node_modules ». Il fournit UNIQUEMENT ping, list_files, read_file, write_file. Les chemins sont relatifs à la racine du partage. Limite de lecture de fichier : 128 Kio. Pas de terminal ni de lancement automatique des agents.
Fichiers particulièrement utiles :
- frontend/src/components/scan/ScanPage.tsx
- frontend/src/components/heatmap/HeatmapPage.tsx
- frontend/src/components/heatmap/BatchExportPanel.tsx
- frontend/src/components/settings/SettingsPage.tsx
- frontend/src/components/upload/UploadPage.tsx
- frontend/src/components/surveys/SurveysLibraryPage.tsx
- frontend/src/components/surveys/SurveysPage.tsx
- frontend/src/components/layout/Navbar.tsx
- frontend/src/index.css
- frontend/package.json
Le projet est en React 19, TypeScript, Vite, Tailwind CSS, Leaflet et React-Leaflet (voir package.json actuel). La branche Git courante sur Kali N'A PAS été vérifiée. Ne pas deviner son état.
Le Figma utilisateur : https://www.figma.com/design/iH7fNkpGvCDCRAWgRxBXb5/Heatmap ; accès bloqué par limite d'appels Starter lors des dernières tentatives. Ne pas dépendre de Figma pour coder.

## Répartition des rôles attendue
ChatGPT : analyse les composants et écrit les modifications ciblées directement via le MCP Kali.
Codex / OpenCode / Kilo Code / Freebuff : agents à exécuter SUR LE PC par l'utilisateur pour effectuer commandes Git, tests npm, débogage et corrections ; ChatGPT ne peut pas les invoquer par son MCP Kali actuel.
Un seul agent local à la fois sur une portion de code pour éviter conflits. Si des erreurs apparaissent, revoir les patches au lieu d'écraser les changements d'un agent.
L'utilisateur valide visuellement sur desktop et smartphone.

## Démarrage sécurisé dans la nouvelle conversation
A. Lire ce document via le MCP Kali, vérifier la branche Git et l'état du dépôt AVANT toute modification. Faire créer une branche dédiée (nom suggéré feature/ui-ux-redesign) depuis le terminal de Kali / un agent local, car le MCP ne dispose pas de commandes shell.
B. Lire les fichiers ACTUELS du projet avant de modifier (ils peuvent avoir changé). Lister tous les impacts puis implémenter par petites étapes indépendantes.
C. Commencer par frontend/src/components/heatmap/BatchExportPanel.tsx : améliorer l'UX sans casser les props, les filtres, le ZIP, la zone full/visible, progress, annulation et erreurs.
D. Ensuite frontend/src/components/settings/SettingsPage.tsx, puis ScanPage.tsx et les composants de marqueurs, toujours desktop + mobile.
E. Pour chaque étape : lancer (via agent/terminal local) npm test, npm run build, ESLint ciblé ; vérifier manuellement le navigateur desktop + mobile ; ne pas prétendre avoir effectué des tests non lancés.
F. Ne pas modifier les données sources, ne pas supprimer de captures/images existantes ni de fonctionnalités. Ne pas pousser Git sans validation explicite de l'utilisateur.

## Consignes pour l'assistant de la nouvelle conversation
Ne pas reprendre l'audit générique ni multiplier les questions : les besoins sont déjà documentés. Confirmer seulement les contraintes nouvelles indispensables. Commencer par lire le dépôt réel et proposer la première modification concrète. L'utilisateur veut une implémentation réelle, pas seulement une maquette, et souhaite utiliser ses agents locaux pour les tests et les corrections.
