# CHANGELOG

## DEV2.11.5 - CTC q8 automatique

- Remplace le CTC direct ONNX lourd par un chargement Transformers.js automatique.
- Modèle CTC par défaut: `Xenova/wav2vec2-base-960h` avec `dtype: q8`.
- Repli automatique: `onnx-community/wav2vec2-base-960h-ONNX`.
- Ajoute un champ avancé pour surcharger l'ID du modèle CTC sans rebuild.
- Messages UX explicites: téléchargement unique d'environ 90 Mo, cache navigateur, texte utilisateur conservé.
- Conserve les fixes DEV2.11.2: vocab `tokens_to_ids`, processor obligatoire, vrais logits CTC uniquement.
