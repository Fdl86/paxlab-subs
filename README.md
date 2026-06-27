# PAXLAB Subs - DEV2 AUTO

Module autonome PAXLAB Subs. Objectif DEV2 : générer automatiquement des captions depuis un fichier audio et des paroles propres, sans serveur audio et sans upload.

## Workflow

1. Charger un MP3 ou WAV.
2. Laisser la langue sur `French - locked for PAX VI`.
3. Coller les paroles propres.
4. Cliquer sur `Generate Lyrics`.
5. Prévisualiser la lecture synchronisée.
6. Exporter SRT, VTT ou JSON.

## Important

- Le texte exporté reste le texte des paroles collées.
- Aucune réécriture des paroles.
- Une normalisation interne est utilisée uniquement pour aligner les mots détectés avec les mots des paroles.
- Le moteur ASR est chargé uniquement au clic sur Generate Lyrics.
- Le premier passage est plus long car le modèle est téléchargé et mis en cache par le navigateur.

## Moteur auto

DEV2 utilise Transformers.js via CDN avec Whisper multilingual. La langue par défaut est `french`.

Modèles proposés :

- Quality : `Xenova/whisper-small`
- Balanced : `Xenova/whisper-base`
- Fast test : `Xenova/whisper-tiny`

Runtime proposé :

- Auto : WebGPU si disponible, sinon WASM CPU.
- WebGPU : meilleur choix si navigateur compatible.
- WASM : fallback CPU plus lent.

## Cloudflare Pages

Réglages recommandés :

```text
Build command: npm run build
Output directory: dist
Root directory: laisser vide
```

Le build est volontairement ultra léger : pas de dépendance npm, le script copie simplement les fichiers statiques dans `dist`.
