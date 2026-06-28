# PAXLAB Subs - DEV2.11.5

Module local de génération de sous-titres depuis audio + paroles propres.

DEV2.11.5 corrige le forced alignment CTC pour une stratégie zéro hébergement: modèle public pré-quantifié q8 chargé au runtime, mis en cache par le navigateur, et repli ASR si indisponible.

## Cloudflare Pages

Build command: `npm run build`
Output directory: `dist`

## Commit recommandé

`DEV2.11.5 - switch CTC to automatic q8 model`
