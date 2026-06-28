# PAXLAB Subs - DEV2.11.6

Module local de génération de sous-titres SRT/VTT/JSON depuis audio + paroles propres.

DEV2.11.6 garde la base CTC automatique q8 fonctionnelle de DEV2.11.5 et améliore le calage : fenêtres CTC larges et multi-lignes, étiquetage par mot `lineIndex/wordIndex`, snapping vocal adaptatif réellement actif, et gating de confiance pour éviter les substitutions CTC douteuses.

## Cloudflare Pages

Build command: `npm run build`
Output directory: `dist`

## Tests

`npm test`
