# PAXLAB Subs DEV2.4 - Responsive UI

Module séparé PAXLAB pour générer des sous-titres depuis audio + paroles propres.

## Objectif DEV2.4

- Reprise de la DA PAXLAB : sombre, champagne, compacte, premium.
- Interface responsive, optimisée pour 1920x1080 sans scroll global.
- Intégration future facilitée : classes CSS préfixées `ps-`, IDs préfixés `ps`, aucun framework UI, aucune dépendance runtime embarquée.
- Runtime stable par défaut : WASM CPU.
- WebGPU conservé en option expérimentale avec préflight.
- Cues live visibles au fur et à mesure des chunks.
- Export SRT, VTT et JSON.
- Traitement local, aucun upload.

## Cloudflare Pages

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

Copier le contenu du dossier `paxlab-subs` à la racine du repo GitHub.
