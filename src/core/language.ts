export const AUDIO_LANGUAGE = {
  code: 'fr-FR',
  label: 'Français',
  asrHint: 'french',
} as const;

export type AudioLanguageCode = typeof AUDIO_LANGUAGE.code;
