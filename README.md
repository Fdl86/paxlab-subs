# PAXLAB Subs - DEV2.11

Module local de génération de sous-titres SRT/VTT/JSON depuis un audio et des paroles propres.

## DEV2.11

Ajoute le Tier B optionnel : alignement forcé CTC.

- Whisper + Needleman-Wunsch restent le chemin nominal.
- Toggle OFF par défaut : `Alignement forcé CTC - précision max`.
- Chargement à la demande d'un modèle wav2vec2 CTC dans `align.worker.js`.
- Trellis CTC + backtracking par fenêtre de cue.
- Substitution des temps mot quand l'alignement CTC réussit.
- Repli transparent sur les timestamps ASR si le modèle, le vocabulaire ou un segment échoue.

## Cloudflare Pages

Build command: `npm run build`
Output directory: `dist`
Root directory: vide

Traitement local : aucun upload du fichier audio.
