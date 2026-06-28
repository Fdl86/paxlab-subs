# Changelog

## DEV2.11.3 - switch CTC to French ONNX model

- Replaced invalid `Xenova/wav2vec2-large-xlsr-53-french` CTC model id with `Poulpidot/wav2vec2-large-xlsr-53-french-onnx`.
- Kept ASR fallback path unchanged if the French ONNX model fails to load or align.
- Preserved DEV2.11.2 tokenizer, processor and logits safety fixes.

## DEV2.11.2 - repair CTC tokenizer path

- Fixed CTC vocabulary extraction for Transformers.js tokenizers exposing `model.tokens_to_ids` as a Map.
- Added `src/ctc-tokens.js` to share tokenizer to ids logic between worker and tests.
- Added regression tests covering Map and array vocabularies.
- Prevented raw unnormalized PCM inference when the CTC processor is unavailable by using a normalized Tensor fallback or failing explicitly.
- Removed unsafe `last_hidden_state` fallback: forced alignment now requires real CTC logits.
- Preserved DEV2.11.1 behavior when forced alignment is disabled.
