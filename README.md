# PAXLAB Subs - DEV2.11.7

Module local de génération et prévisualisation de sous-titres PAXLAB.

DEV2.11.7 repart de la base fonctionnelle DEV2.11.5 Claude et ajoute un correctif conservateur : réparation prudente des gros trous d'intro, garde-fous sur lignes courtes, plafonds de durée pour éviter les cues absurdes, et version visible corrigée. Le modèle CTC auto q8 reste disponible via toggle, sans upload ni hébergement personnel.

## Cloudflare Pages

Build command : `npm run build`
Output directory : `dist`
Root directory : vide

## Tests

`npm test`
