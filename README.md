# PAXLAB Subs DEV2.5 - Timestamp UX

Module séparé PAXLAB pour générer des sous-titres depuis audio + paroles propres.

## Objectif DEV2.5

- Conserver la DA PAXLAB sombre/champagne et l'interface responsive DEV2.4.
- Ajouter la sélection d'une cue par simple clic.
- Ajouter l'ajustement immédiat des timestamps de la cue sélectionnée : début, fin ou cue complète.
- Conserver le double-clic sur une cue pour aller directement au bon moment de lecture.
- Ne plus afficher de texte parasite pendant les blancs/interludes lorsqu'une timeline existe déjà.
- Stabiliser visuellement le bloc moteur/progression pour éviter les textes longs et les ruptures CSS.
- Export SRT, VTT et JSON avec les corrections de timestamps appliquées.
- Traitement local, aucun upload.

## Cloudflare Pages

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

Copier le contenu du dossier `paxlab-subs` à la racine du repo GitHub.
