# CHANGELOG

## DEV2.11.4 - Direct ONNX French CTC

- Charge `Poulpidot/wav2vec2-large-xlsr-53-french-onnx` via ONNX Runtime direct.
- N'utilise plus AutoTokenizer pour ce modèle, donc plus de recherche de `tokenizer.json`.
- Charge `vocab.json`, `preprocessor_config.json`, `special_tokens_map.json` et `tokenizer_config.json` manuellement.
- Lance `model.onnx` avec `InferenceSession` ORT Web.
- Conserve les diagnostics CTC : modèle, session, inputs, outputs, logits, tokens, segments.
- Fallback ASR propre si le modèle ONNX direct échoue.
