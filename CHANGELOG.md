# Changelog

## DEV2.4

- Refonte UI/UX responsive basée sur la DA PAXLAB.
- Layout desktop 1920x1080 en écran unique : header, trois colonnes, player bas.
- CSS préfixé `ps-` pour intégration future dans PAXLAB.
- IDs DOM préfixés `ps` pour éviter les collisions.
- Ajout d’un panneau moteur live plus visible : phase, elapsed, engine, chunk, cues, mots ASR.
- Ajout d’un bouton Test runtime.
- Ajout d’un bouton Stop avec interruption après chunk courant.
- Conservation du pipeline auto DEV2.3 : WASM stable par défaut, WebGPU expérimental, chunks courts, exports SRT/VTT/JSON.
