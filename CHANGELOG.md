# CHANGELOG

## DEV2.11.7 - Conservative gap repair baseline

- Base fonctionnelle reprise depuis `paxlab-subs-dev2-11-5-auto-ctc.zip`.
- Version affichée corrigée en DEV2.11.7.
- Ajout d'une réparation conservatrice des gros trous intro / reprise vocale, sans fenêtres CTC larges permissives.
- Ajout de garde-fous : les lignes courtes ne servent pas de correction forte, et une cue ne peut plus être étirée absurdement par le CTC.
- CTC auto q8 conservé, OFF par défaut, fallback ASR inchangé.
- Tests alignement enrichis avec le cas d'intro Rocroi.

# CHANGELOG

## DEV2.11.5 - CTC automatique et léger (fin du modèle 1,26 Go)

- **Alignement forcé 100 % automatique, sans hébergement ni conversion.**
- Abandon de `Poulpidot/wav2vec2-large-xlsr-53-french-onnx` (fp32, 1,26 Go) comme défaut.
- Charge un modèle wav2vec2 CTC **public déjà quantifié** via transformers.js en `dtype:'q8'` (~90 Mo, mis en cache) : `Xenova/wav2vec2-base-960h`, repli `onnx-community/wav2vec2-base-960h-ONNX`.
- **Modèle chargé via transformers.js (AutoModelForCTC)**, mais **tokenizer construit directement depuis `vocab.json`** : plus de dépendance à `tokenizer.json` (cause du blocage précédent).
- Normalisation d'entrée conditionnée par `preprocessor_config.json` (`do_normalize` : false pour base-960h).
- Acoustique anglais utilisé pour caler le texte FR connu (forced-alignment : pas de transcription) ; texte exporté = paroles utilisateur, inchangé.
- Alignement forcé toujours exécuté en WASM (q8 fiable), segments courts. Repli ASR propre si indisponible.
- Override possible vers un autre modèle public déjà quantifié de la liste (sinon défaut).


## DEV2.11.4 - Direct ONNX French CTC

- Charge `Poulpidot/wav2vec2-large-xlsr-53-french-onnx` via ONNX Runtime direct.
- N'utilise plus AutoTokenizer pour ce modèle, donc plus de recherche de `tokenizer.json`.
- Charge `vocab.json`, `preprocessor_config.json`, `special_tokens_map.json` et `tokenizer_config.json` manuellement.
- Lance `model.onnx` avec `InferenceSession` ORT Web.
- Conserve les diagnostics CTC : modèle, session, inputs, outputs, logits, tokens, segments.
- Fallback ASR propre si le modèle ONNX direct échoue.
