# CHANGELOG

## DEV2.11.12 - Keyboard shortcuts and selected cue focus

- Ajout des raccourcis clavier Q/S/D pour le workflow de correction rapide.
- `Q` cale le début de la cue sélectionnée sur le marqueur.
- `S` et `Espace` lancent ou stoppent la lecture, hors champs texte.
- `D` cale la fin de la cue sur le marqueur puis sélectionne automatiquement la cue suivante.
- Contour significatif ajouté pour distinguer la cue sélectionnée de la cue active en lecture.
- Rappel discret des raccourcis dans la zone Timeline.
- Aucun changement moteur, modèle, détection ou export.


## DEV2.11.11 - Smooth timeline and active cue focus

- Lissage visuel de la ligne de temps pendant la lecture avec horloge UI basée sur `requestAnimationFrame`.
- Résolution de la barre de lecture augmentée pour réduire le jitter du marqueur.
- Mise en avant renforcée de la cue active avec fond champagne premium.
- Auto-scroll centré sur la cue active pour un suivi plus lisible.
- Aucun changement moteur, modèle, détection ou export.


## DEV2.11.10 - Cue editing UX polish

- Suppression de la box ASR visible pour alléger l'interface.
- Preview réduite et fusionnée avec les contrôles de lecture.
- Suppression du bouton "Play preview" au profit d'un bouton Play compact intégré sous la preview.
- Réglages avancés déplacés sous la preview et réorganisés horizontalement.
- Affichage des temps de cues en format MM:SS.cc pour correspondre au marqueur de timeline.
- Ajout des boutons "Début = marqueur" et "Fin = marqueur" pour caler une cue sur la position courante.
- Auto-scroll de la liste pour garder la cue active visible pendant la lecture.
- Aucun changement moteur, modèle, détection ou export.

## DEV2.11.9 - Safe detection flags

- Ajout d'une analyse qualité non destructive par cue.
- Badges visibles dans la timeline : OK, ligne courte, hook répété, intro/silence, grand blanc, durée longue, lecture rapide, confiance basse, CTC rejeté.
- Résumé compact des cues à vérifier dans l'en-tête Timeline.
- Les flags n'altèrent pas les timings et ne changent pas les exports SRT/VTT.
- Ajout d'un test garantissant que les flags détectent le pattern intro/silence sans retiming.
- Version visible, README et package mis à jour en DEV2.11.9.

## DEV2.11.8 - Polish PAXLAB UI layout

- Passe UI/UX uniquement, sans changement moteur.
- Refonte en trois zones : Source, Preview, Timeline.
- Déplacement des paroles dans la zone Source pour réduire le bazar visuel.
- Réglages avancés, moteur et diagnostics repliés dans un panneau dédié.
- Boutons d'action importants retravaillés avec effet 3D champagne façon PAXLAB.
- Alignements, hauteurs, espacements et scrolling interne resserrés.
- Version visible, README et package mis à jour en DEV2.11.8.

## DEV2.11.7 - Conservative gap repair baseline

- Base fonctionnelle reprise depuis `paxlab-subs-dev2-11-5-auto-ctc.zip`.
- Version affichée corrigée en DEV2.11.7.
- Ajout d'une réparation conservatrice des gros trous intro / reprise vocale, sans fenêtres CTC larges permissives.
- Ajout de garde-fous : les lignes courtes ne servent pas de correction forte, et une cue ne peut plus être étirée absurdement par le CTC.
- CTC auto q8 conservé, OFF par défaut, fallback ASR inchangé.
- Tests alignement enrichis avec le cas d'intro Rocroi.

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
