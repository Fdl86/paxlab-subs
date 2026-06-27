# CHANGELOG

## DEV2 AUTO

- Ajout d'une vraie génération automatique basée ASR local navigateur.
- Ajout du moteur Whisper via Transformers.js chargé uniquement à la demande.
- Langue française verrouillée par défaut pour PAX VI.
- Alignement automatique entre transcript ASR et paroles propres.
- Export SRT, VTT et JSON depuis les cues générées.
- Preview synchronisée avec surlignage du mot actif.
- UI conservée dans l'esprit DEV0.2, plus proche du workflow Caption X.
- Suppression du mode draft par répartition naïve comme flux principal.
- Build Cloudflare ultra léger : pas de node_modules, pas de package-lock, pas de bundle lourd.
