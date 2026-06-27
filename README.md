# PAXLAB Subs DEV2.6 - Model Selector + Engine Panel

Module séparé PAXLAB pour générer des sous-titres depuis audio + paroles propres.

## Objectif DEV2.6

- Rendre le choix du modèle Whisper évident dans l'interface.
- Garder le runtime stable WASM CPU par défaut.
- Corriger le panneau Moteur live pour éviter les chevauchements visuels.
- Afficher clairement le modèle, le runtime, le chunk, la phase et la progression.

## Workflow

1. Importer un MP3 ou WAV local.
2. Coller les paroles propres, sans nettoyage automatique.
3. Choisir le modèle Whisper : Tiny, Base ou Small.
4. Garder WASM CPU pour le mode stable.
5. Générer les sous-titres.
6. Prévisualiser, ajuster les cues, exporter SRT / VTT / JSON.

## Cloudflare Pages

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Root directory : vide si le contenu du dossier `paxlab-subs` est copié à la racine du repo.
