import { loadTTSSettings } from '@/utils/tts';

export type AppLanguage = 'english' | 'spanish';

export async function loadAppLanguage(): Promise<AppLanguage> {
  const settings = await loadTTSSettings();
  return settings.language;
}

export function isSpanish(language: AppLanguage): boolean {
  return language === 'spanish';
}
