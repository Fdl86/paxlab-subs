# Changelog

## DEV2.5

- Ajout d'un panneau d'édition de cue sélectionnée dans la timeline.
- Simple clic sur une cue : sélection de la cue.
- Double-clic sur une cue : saut immédiat au timestamp et lecture.
- Boutons d'ajustement immédiat : début -/+0.05s, fin -/+0.05s, cue entière -/+0.05s.
- Les exports SRT/VTT/JSON reprennent les timestamps corrigés.
- Suppression du placeholder de preview pendant les blancs entre deux sous-titres.
- Stabilisation du bloc moteur live : statut court, barre plus lisible, métriques fixes, hint tronqué proprement.
- Version JSON interne mise à jour en `dev2-5-timestamp-ux`.

## DEV2.4

- Refonte UI/UX responsive basée sur la DA PAXLAB.
- Layout desktop 1920x1080 en écran unique : header, trois colonnes, player bas.
- CSS préfixé `ps-` pour intégration future dans PAXLAB.
- IDs DOM préfixés `ps` pour éviter les collisions.
- Ajout d’un panneau moteur live plus visible : phase, elapsed, engine, chunk, cues, mots ASR.
- Ajout d’un bouton Test runtime.
- Ajout d’un bouton Stop avec interruption après chunk courant.
- Conservation du pipeline auto DEV2.3 : WASM stable par défaut, WebGPU expérimental, chunks courts, exports SRT/VTT/JSON.
