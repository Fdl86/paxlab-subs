# PAXLAB Subs - DEV2.11.12

Module local de génération et prévisualisation de sous-titres PAXLAB.

DEV2.11.12 est une passe UX ciblée sur le montage rapide : raccourcis clavier Q/S/D, sélection visuelle renforcée, et passage automatique à la cue suivante après calage de la fin. Le moteur DEV2.11.9/DEV2.11.10/DEV2.11.11 reste inchangé.

## Raccourcis

- `Q` : caler le début de la cue sélectionnée sur le marqueur.
- `S` : Play / Pause.
- `Espace` : Play / Pause.
- `D` : caler la fin de la cue sélectionnée sur le marqueur puis sélectionner la cue suivante.

Les raccourcis sont ignorés pendant l'édition d'un champ texte ou timing.

## Cloudflare Pages

Build command : `npm run build`
Output directory : `dist`
Root directory : vide

## Tests

`npm test`
