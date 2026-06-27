# CHANGELOG

## DEV2.1 AUTO PROGRESS

- Ajout d’une progression visible pendant le traitement automatique.
- Ajout des indicateurs `Phase`, `Elapsed` et `Engine`.
- Ajout d’un heartbeat pendant la transcription française.
- Message d’avertissement si la transcription dure plus de 60s ou 180s.
- Modèle par défaut passé sur `Whisper base FR` pour un meilleur compromis temps/qualité.
- Conservation du workflow DEV2 : audio + paroles propres -> génération automatique SRT/VTT/JSON.
- Build Cloudflare toujours ultra léger.

## DEV2 AUTO

- Ajout d’une génération automatique basée ASR local navigateur.
- Ajout du moteur Whisper via Transformers.js chargé uniquement à la demande.
- Langue française verrouillée par défaut pour PAX VI.
- Alignement automatique entre transcript ASR et paroles propres.
