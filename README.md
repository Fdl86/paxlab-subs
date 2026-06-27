# PAXLAB Subs - DEV0.1

Prototype separe du module sous-titres PAXLAB.

Objectif DEV0.1 : lecteur audio local, import SRT/VTT, affichage synchronise, surlignage du mot actif pendant la lecture, exports SRT/VTT/JSON.

Langue moteur verrouillee : francais `fr-FR`.

## Cloudflare Pages

Reglage recommande si le contenu du dossier `paxlab-subs` est copie a la racine du repo GitHub :

- Build command : `npm run build`
- Output directory : `dist`
- Root directory : laisser vide

Si le dossier `paxlab-subs` est pousse tel quel dans le repo, sans copier son contenu a la racine :

- Root directory : `paxlab-subs`
- Build command : `npm run build`
- Output directory : `dist`

## Installation locale

```bash
npm install
npm run build
npm run preview
```

Puis ouvrir `http://localhost:5173`.

## Notes

- Aucun upload.
- Aucun serveur audio.
- Aucun FFmpeg.
- Aucune IA en DEV0.1.
- Les paroles collees ne sont pas nettoyees ni modifiees.
- Le SRT/VTT de reference reste ligne par ligne.
- Le surlignage mot actif est calcule a la lecture par le lecteur.
