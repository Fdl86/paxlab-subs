# PAXLAB Subs - DEV2.10

Module autonome destiné à être intégré plus tard dans PAXLAB.

## Objectif

Créer localement des sous-titres SRT/VTT/JSON depuis :

- un fichier audio MP3/WAV ;
- des paroles propres collées par l’utilisateur ;
- une transcription Whisper exécutée côté navigateur.

Aucun upload, aucun backend. Le texte exporté reste toujours celui des paroles utilisateur ; l’ASR ne sert qu’au timing.

## DEV2.10

Cette version améliore la détection en une passe Tier 1 :

- prompt compact construit depuis les paroles pour guider Whisper, toggle ON par défaut ;
- `condition_on_prev_tokens:false` pour limiter l’emballement/hallucination ;
- matching phonétique FR léger dans l’alignement Needleman-Wunsch ;
- précalcul des clés phonétiques pour garder l’alignement rapide ;
- snapping local des débuts de cues sur les attaques vocales, toggle ON par défaut ;
- suppression des balises de structure Suno/Udio dans le parsing ;
- éclatement des élisions FR uniquement pour le matching, sans changer le texte affiché/exporté ;
- ajout du modèle lourd `large-v3-turbo` dans le sélecteur ;
- fallback modèle robuste côté worker ;
- tests d’alignement étendus.

## Cloudflare Pages

Build command:

```text
npm run build
```

Output directory:

```text
dist
```

Root directory : laisser vide si les fichiers sont à la racine du repo.

## Tests

```bash
npm test
```

## Notes

Runtime par défaut : WASM CPU stable. WebGPU reste expérimental. `large-v3-turbo` est volontairement étiqueté lourd et n’est pas sélectionné par défaut.
