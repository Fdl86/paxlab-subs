# PAXLAB Subs - DEV2.7

Module autonome de génération locale de sous-titres depuis audio + paroles propres.

## DEV2.7

- Reprise complète de l'interface PAXLAB sombre / champagne.
- Sélecteur de modèle Whisper visible dans les réglages.
- Layout desktop stabilisé pour 1920x1080.
- Panneau moteur live restructuré, sans chevauchement.
- Timeline, édition de cues, preview et exports conservés.
- CSS et IDs préfixés `ps-` pour intégration future dans PAXLAB.
- Aucun backend, aucun upload, pas de package-lock, build Cloudflare statique.

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
