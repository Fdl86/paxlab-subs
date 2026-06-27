# Changelog

## DEV2.3 - Stable Runtime

- Runtime par défaut basculé sur WASM CPU, car WebGPU peut rester bloqué selon navigateur/GPU/driver.
- Option WebGPU conservée comme test expérimental uniquement.
- Ajout d'un préflight WebGPU avant le chargement Whisper.
- Chunks ASR réduits de 28s à 12s pour obtenir des cues visibles plus vite.
- Messages de statut clarifiés pour distinguer runtime stable et runtime expérimental.
