# PAXLAB Subs - DEV2.1 AUTO PROGRESS

Module autonome PAXLAB Subs. Objectif DEV2.1 : génération automatique de captions depuis audio et paroles propres, avec suivi visible pendant le chargement modèle, la transcription et l’alignement.

## Workflow

1. Charger un MP3 ou WAV.
2. Laisser la langue sur `French - locked for PAX VI`.
3. Coller les paroles propres.
4. Cliquer sur `Generate Lyrics`.
5. Suivre les indicateurs `Status`, `Phase`, `Elapsed` et `Engine`.
6. Prévisualiser la lecture synchronisée.
7. Exporter SRT, VTT ou JSON.

## Important

- Le texte exporté reste le texte des paroles collées.
- Aucune réécriture des paroles.
- Le moteur ASR est chargé uniquement au clic sur Generate Lyrics.
- Pendant l’appel Whisper, le navigateur ne fournit pas toujours un pourcentage exact. DEV2.1 ajoute donc un timer, une phase active et un indicateur de progression souple pour confirmer que le traitement continue.
- Pour un test rapide, utiliser `Fast test - Whisper tiny FR`. Pour un meilleur résultat, utiliser `Balanced` ou `Quality`.

## Cloudflare Pages

Réglages recommandés :

```text
Build command: npm run build
Output directory: dist
Root directory: laisser vide
```

Le build reste statique et léger : pas de node_modules, pas de package-lock, pas de modèle embarqué.
