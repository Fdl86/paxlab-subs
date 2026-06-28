# PAXLAB Subs - DEV2.11.9

Module local de génération et prévisualisation de sous-titres PAXLAB.

DEV2.11.9 ajoute une couche de détection prudente après génération : badges de qualité par cue, résumé des lignes à vérifier, signalement des lignes courtes, hooks répétés, grands blancs, durées anormales, confiance basse et ruptures intro/silence. Cette passe ne retime pas les sous-titres et ne modifie pas les exports SRT/VTT. La base UI DEV2.11.8 et le moteur DEV2.11.7 restent conservés.

## Cloudflare Pages

Build command : `npm run build`
Output directory : `dist`
Root directory : vide

## Tests

`npm test`
