# Changelog

## DEV0.3 - cue timeline fixes

- Base conservée : DEV0.2.
- Ajout d'une timeline de cues générées sous le lecteur.
- Double-clic sur une cue : déplacement immédiat de la lecture au timestamp correspondant.
- Correction du comportement de scroll : la timeline défile dans son propre panneau, sans faire descendre toute la page.
- Correction du rendu des cues courtes de type `Vercingétorix !` : la ponctuation seule n'est plus considérée comme un mot actif.
- Le sample Vercingétorix utilise désormais le SRT de référence fourni.
- Export SRT/VTT/JSON conservé.
- Langue moteur conservée en `fr-FR` par défaut.

## DEV0.2 - UI lyrics to captions

- UI rapprochée du workflow lyrics-to-captions.
- Upload audio, langue, segmentation, paroles, génération, preview, exports.
- Suppression de l'import SRT/VTT du flux principal.
