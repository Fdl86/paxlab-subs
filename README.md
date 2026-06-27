# PAXLAB Subs - DEV2.2 Live Cues

Module séparé PAXLAB pour créer des sous-titres depuis un audio et des paroles propres.

## Objectif DEV2.2

- Détection automatique audio + paroles propres.
- Langue française verrouillée par défaut pour PAX VI.
- Transcription progressive par segments audio.
- Affichage des cues au fur et à mesure de l'avancée.
- Preview synchronisée avec surlignage champagne du mot actif.
- Export SRT, VTT et JSON.

## Cloudflare Pages

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Root directory: laisser vide si le contenu du dossier `paxlab-subs` est copié à la racine du repo.

## Notes

Le premier passage peut être long, car le modèle Whisper est téléchargé puis mis en cache par le navigateur. Les cues apparaissent maintenant chunk par chunk, dès qu'un segment audio est terminé.
