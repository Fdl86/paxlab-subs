# PAXLAB Subs - DEV0.3

Prototype séparé du module sous-titres PAXLAB.

Objectif actuel : valider le workflow léger avant intégration future dans PAXLAB Browser.

## Fonctionnel

- Upload local MP3/WAV.
- Langue par défaut : French `fr-FR`.
- Collage de paroles propres uniquement.
- Génération de captions depuis la référence Vercingétorix ou depuis le répartiteur léger provisoire.
- Preview synchronisée.
- Surlignage du mot actif pendant la lecture.
- Timeline de cues générées.
- Double-clic sur une cue pour aller directement au bon moment de la chanson.
- Export SRT, VTT et JSON.
- Aucun upload serveur.
- Aucune IA chargée en DEV0.
- Aucun FFmpeg.

## Cloudflare Pages

Copier le contenu du dossier `paxlab-subs` à la racine du repo GitHub.

Réglages Cloudflare :

```text
Build command: npm run build
Output directory: dist
Root directory: laisser vide
```

## Dev local

```bash
npm install
npm run build
```

Puis ouvrir `dist/index.html` via un serveur statique local.
