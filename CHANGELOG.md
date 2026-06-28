# Changelog

## DEV2.10 - improve detection tier 1

- Ajout d’un prompt compact basé sur les paroles pour guider Whisper.
- Ajout des toggles `Guider Whisper avec les paroles` et `Aligner sur l’attaque vocale`.
- Ajout du matching phonétique FR dans l’alignement global.
- Précalcul des clés phonétiques pour éviter le surcoût dans la DP.
- Ajout du snapping VAD local des débuts de cues.
- Suppression des balises de structure Suno/Udio dans le parsing.
- Éclatement des élisions FR uniquement pour densifier les ancres d’alignement.
- Ajout du modèle lourd `large-v3-turbo` avec fallback côté worker.
- Extension des tests d’alignement : phonétique, élisions, balises et non-régressions.

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
