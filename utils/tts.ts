import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS, READING_SPEEDS } from '@/constants/wiretrace';

export interface TTSSettings {
  speed: 'slow' | 'normal' | 'fast';
  voice: 'default' | 'male' | 'female';
  autoAdvanceDelay: 'off' | '3s' | '5s' | '10s';
}

export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  speed: 'normal',
  voice: 'default',
  autoAdvanceDelay: 'off',
};

export async function loadTTSSettings(): Promise<TTSSettings> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.SETTINGS);
    if (!raw) return DEFAULT_TTS_SETTINGS;
    return { ...DEFAULT_TTS_SETTINGS, ...(JSON.parse(raw) as Partial<TTSSettings>) };
  } catch {
    return DEFAULT_TTS_SETTINGS;
  }
}

export async function saveTTSSettings(settings: TTSSettings): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  console.log('[TTS] Settings saved', settings);
}

export async function speakText(text: string, onDone?: () => void): Promise<void> {
  const settings = await loadTTSSettings();
  const rate = READING_SPEEDS[settings.speed];

  console.log('[TTS] Speaking text', { length: text.length, rate, voice: settings.voice });

  // Stop any current speech
  await Speech.stop();

  const options: Speech.SpeechOptions = {
    rate,
    onDone: () => {
      console.log('[TTS] Speech done');
      onDone?.();
    },
    onError: (err) => {
      console.error('[TTS] Speech error', err);
    },
  };

  Speech.speak(text, options);
}

export async function stopSpeech(): Promise<void> {
  console.log('[TTS] Stopping speech');
  await Speech.stop();
}

export function getAutoAdvanceMs(delay: TTSSettings['autoAdvanceDelay']): number | null {
  switch (delay) {
    case '3s': return 3000;
    case '5s': return 5000;
    case '10s': return 10000;
    default: return null;
  }
}
