# PAXLAB Subs - DEV2.11.3

Module local de sous-titres automatiques PAXLAB.

## DEV2.11.3

Correctif ciblé du modèle CTC français : remplacement du repo invalide `Xenova/wav2vec2-large-xlsr-53-french` par `Poulpidot/wav2vec2-large-xlsr-53-french-onnx`.

Les correctifs DEV2.11.2 restent présents : vocab/tokenizer Transformers.js 3.5.2, processor sécurisé, rejet des sorties sans vrais logits CTC. Le chemin nominal reste inchangé lorsque le toggle CTC est désactivé.

## Cloudflare Pages

Build command:

```text
npm run build
```

Output directory:

```text
dist
```
