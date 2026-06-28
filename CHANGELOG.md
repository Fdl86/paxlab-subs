# CHANGELOG

## DEV2.11.6 - fenêtres CTC larges et VAD réel

- Correction du mapping multi-lignes CTC : le worker renvoie maintenant `lineIndex` / `wordIndex` depuis chaque mot source, pas depuis le segment global.
- Remplacement des fenêtres CTC trop serrées par des super-segments larges ancrés sur les lignes fiables, avec limite 40 s et recouvrement.
- Ajout de fenêtres de secours larges pour rattraper les intros, blancs et ruptures de structure mal placés par le coarse ASR/NW.
- Snapping vocal repris avec détection d'onsets adaptative sur le PCM 16 kHz, et application uniquement sur les débuts de cues peu fiables.
- Gating de confiance CTC : les mots/lignes à score trop faible ne remplacent plus les timestamps ASR.
- Tests enrichis pour couvrir le vocab CTC, les fenêtres larges d'intro et la substitution multi-lignes.

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
