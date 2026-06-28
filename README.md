# PAXLAB Subs - DEV2.11.4

Module local de génération de sous-titres SRT/VTT/JSON depuis audio + paroles propres.

DEV2.11.4 corrige le chargement CTC français en utilisant Poulpidot/wav2vec2-large-xlsr-53-french-onnx via ONNX Runtime direct : `model.onnx` + `vocab.json`, sans dépendre de `tokenizer.json`.

## Cloudflare Pages

Build command: `npm run build`
Output directory: `dist`

## Tests

`npm test`
