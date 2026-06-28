# CHANGELOG

## DEV2.11.1 - CTC diagnostics and timing source

- Ajout d’un diagnostic CTC visible dans le panneau moteur.
- Affichage du statut CTC, mots substitués, cues affectées, cues modifiées et delta moyen.
- Badges ASR / CTC dans la liste des cues.
- Export JSON enrichi avec `ctcStats` et `timingSource` par cue.
- Alertes explicites si CTC charge mais ne substitue aucun timestamp.
- Messages worker CTC enrichis : modèle chargé, segments, mots demandés, mots alignés, erreurs/fallback.
- Non-régression du chemin ASR / Needleman-Wunsch quand le toggle CTC est désactivé.
