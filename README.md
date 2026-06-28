# PAXLAB Subs - DEV2.9

Module autonome destiné à être intégré plus tard dans PAXLAB.

## Objectif

Créer localement des sous-titres SRT/VTT/JSON depuis :

- un fichier audio MP3/WAV ;
- des paroles propres collées telles quelles ;
- une transcription Whisper exécutée côté navigateur.

Aucun upload, aucun backend.

## DEV2.9

Cette version refond le moteur :

- ASR dans un Web Worker module ;
- un seul appel Whisper avec chunking natif 30 s et stride 5 s ;
- décodage/resampling audio via OfflineAudioContext en mono 16 kHz ;
- alignement global Needleman-Wunsch entre paroles propres et mots ASR ;
- contraintes CPS pour éviter les cues trop rapides ;
- rendu preview anti-jank : la ligne active n'est plus reconstruite à chaque frame ;
- piste temporelle légère avec blocs de cues et tête de lecture ;
- édition directe start/end + boutons +/-0.05 s ;
- `_headers` Cloudflare avec COOP/COEP credentialless ;
- tests Node pour l'aligneur.

## Cloudflare Pages

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

Root directory : laisser vide si les fichiers sont à la racine du repo.

## Tests

```bash
npm test
```

## Notes

Runtime par défaut : WASM CPU stable. WebGPU reste expérimental.
