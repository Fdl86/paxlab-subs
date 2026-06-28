# Changelog

## DEV2.9 - ASR worker and global alignment

- Refactor majeur du pipeline ASR.
- Ajout de `src/asr.worker.js` pour exécuter Whisper hors du thread UI.
- Suppression du découpage maison 12 s et passage à un seul appel Whisper avec `chunk_length_s: 30` et `stride_length_s: 5`.
- Ajout d'un alignement global Needleman-Wunsch pour mieux gérer erreurs ASR, mots parasites et refrains répétés.
- Ajout de contraintes CPS pour améliorer la lisibilité des sous-titres.
- Décodage audio par `OfflineAudioContext` en mono 16 kHz.
- Ajout d'une piste temporelle légère et d'une édition directe des bornes start/end.
- Simplification du surlignage mot actif et correction durable des espaces en preview.
- Ajout `_headers` Cloudflare avec COOP/COEP credentialless.
- Ajout `tests/align.test.mjs`.
