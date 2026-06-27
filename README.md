# PAXLAB Lyrics Sync - DEV0

Prototype separe pour futur module PAXLAB.

Objectif DEV0 :

- lecture audio locale ;
- import SRT ou VTT ;
- import/collage de paroles propres ;
- preview sous-titres style PAXLAB champagne ;
- surlignage du mot actif pendant la lecture ;
- export SRT, VTT et JSON ;
- aucune IA, aucun upload, aucun serveur audio, aucune dependance runtime.

La langue moteur est verrouillee en francais : `fr-FR`.
Le prototype ne nettoie pas les paroles et ne modifie pas le texte source.

## Lancer

Option simple avec serveur local :

```bash
cd paxlab-lyrics-sync-dev0
python3 -m http.server 5173
```

Puis ouvrir :

```text
http://localhost:5173
```

Le bouton `Charger l’exemple Vercingetorix` fonctionne via serveur local.

## Build TypeScript

Le code compile sans dependance runtime. TypeScript est la seule dependance de dev.

```bash
npm install
npm run build
```

Dans l'environnement actuel, `dist/main.js` est deja compile.

## Fichiers importants

```text
index.html
src/styles.css
src/main.ts
src/core/captions.ts
src/core/files.ts
src/core/language.ts
src/core/time.ts
dist/main.js
public/samples/vercingetorix.mp3
public/samples/vercingetorix.vtt
public/samples/vercingetorix.srt
public/samples/vercingetorix.txt
```

## Notes produit

DEV0 ne genere pas encore automatiquement les timestamps depuis audio + paroles.
La priorite est de verrouiller le lecteur, le rendu champagne, le parsing SRT/VTT, le surlignage mot actif et les exports.

Le surlignage mot actif est calcule a la lecture a partir de la duree de la cue ligne par ligne. Il ne depend pas de timestamps mot par mot dans le SRT/VTT.

## Roadmap immediate

DEV1 : generation automatique ligne par ligne depuis audio + paroles propres, objectif comparaison avec la reference Caption X.
DEV2 : panneau de correction rapide des timings.
DEV3 : integration lazy-load dans PAXLAB.
