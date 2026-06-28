# PAXLAB Subs - DEV2.11.1

Module statique local pour générer des sous-titres à partir d’un audio et de paroles propres.

## DEV2.11.1

Cette build ne change pas le moteur principal : elle rend le forced alignment CTC observable.

À tester :

1. Générer avec CTC désactivé pour vérifier le chemin ASR nominal.
2. Générer avec CTC activé.
3. Regarder le panneau Diagnostic CTC : statut, mots, cues, delta.
4. Vérifier les badges `ASR` / `CTC` dans la timeline.
5. Exporter le JSON pour lire `ctcStats` et `timingSource` par cue.

Si CTC ON donne 0 différence, cette build doit indiquer si le problème vient du chargement modèle, de l’absence de mots alignés, ou de la substitution.

## Cloudflare Pages

Build command : `npm run build`
Output directory : `dist`
Root directory : laisser vide.
