# PAXLAB Subs DEV2.3 - Stable Runtime

Module séparé PAXLAB pour générer des sous-titres depuis audio + paroles propres.

## DEV2.3

- Runtime par défaut: WASM CPU stable.
- WebGPU conservé uniquement en option expérimentale.
- Préflight WebGPU avant chargement du modèle, avec bascule vers WASM si non utilisable.
- Chunks réduits à 12 secondes pour afficher les premières cues plus rapidement.
- Langue française conservée par défaut pour PAX VI.
- Aucun serveur, aucun upload, aucun modèle embarqué.

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
