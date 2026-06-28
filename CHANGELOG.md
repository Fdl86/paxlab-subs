# Changelog

## DEV2.11 - Forced alignment CTC

- Ajout d'un worker `align.worker.js` dédié à l'alignement forcé.
- Ajout d'un toggle optionnel OFF par défaut : alignement forcé CTC.
- Ajout des utilitaires CTC : log-softmax ciblé, trellis, backtracking, agrégation mot.
- Ajout de la substitution des timings mot dans les cues existantes.
- Repli transparent vers Whisper + Needleman-Wunsch si l'alignement forcé échoue.
- JSON export enrichi avec `forcedAlignment` et `forcedWords`.
- Tests synthétiques CTC ajoutés.
