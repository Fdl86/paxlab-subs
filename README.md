# PAXLAB Subs - DEV2.11.5

Module local de génération de sous-titres SRT/VTT/JSON depuis audio + paroles propres.

DEV2.11.5 rend l'alignement forcé CTC 100 % automatique et léger : modèle wav2vec2 CTC public déjà quantifié (`Xenova/wav2vec2-base-960h`, q8 ~90 Mo) chargé via transformers.js, tokenizer construit depuis `vocab.json` (plus de dépendance à `tokenizer.json`). Le modèle FR fp32 1,26 Go est abandonné. Acoustique EN servant à caler le texte FR connu ; texte exporté = paroles utilisateur.

## Cloudflare Pages

Build command: `npm run build`
Output directory: `dist`

## Tests

`npm test`
