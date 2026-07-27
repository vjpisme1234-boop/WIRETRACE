import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS, READING_SPEEDS } from '@/constants/wiretrace';

export interface TTSSettings {
  speed: 'slow' | 'normal' | 'fast';
  voice: 'default' | 'male' | 'female';
  autoAdvanceDelay: 'off' | '3s' | '5s' | '10s';
  language: 'english' | 'spanish';
}

export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  speed: 'normal',
  voice: 'default',
  autoAdvanceDelay: 'off',
  language: 'english',
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

type SpeechVoice = {
  identifier?: string;
  name?: string;
  language?: string;
  quality?: string;
};

let voiceCachePromise: Promise<SpeechVoice[]> | null = null;

async function getAvailableVoices(): Promise<SpeechVoice[]> {
  if (!voiceCachePromise) {
    voiceCachePromise = Speech.getAvailableVoicesAsync()
      .then((voices) => voices as SpeechVoice[])
      .catch((error) => {
        console.error('[TTS] Failed to load voices', error);
        return [];
      });
  }
  return voiceCachePromise;
}

function matchesPreferredGender(voiceName: string, preferred: TTSSettings['voice']): boolean {
  const normalized = voiceName.toLowerCase();
  if (preferred === 'female') {
    return /(female|woman|zira|samantha|victoria|alloy|aria|ana|sofia|lucia)/i.test(normalized);
  }
  if (preferred === 'male') {
    return /(male|man|david|daniel|jorge|carlos|diego|juan|matthew)/i.test(normalized);
  }
  return true;
}

async function getBestVoiceIdentifier(language: 'english' | 'spanish', preferred: TTSSettings['voice']): Promise<string | undefined> {
  const voices = await getAvailableVoices();
  if (voices.length === 0) return undefined;

  const preferredPrefixes = language === 'spanish' ? ['es-', 'es_'] : ['en-', 'en_'];
  const fallbackPrefixes = language === 'spanish' ? ['es'] : ['en'];

  const sameLanguageVoices = voices.filter((voice) => {
    const code = String(voice.language || '').toLowerCase();
    return preferredPrefixes.some((prefix) => code.startsWith(prefix)) || fallbackPrefixes.some((prefix) => code.startsWith(prefix));
  });

  const candidates = sameLanguageVoices.length > 0 ? sameLanguageVoices : voices;

  const scored = candidates.map((voice) => {
    const name = String(voice.name || '');
    const quality = String(voice.quality || '').toLowerCase();
    const languageCode = String(voice.language || '').toLowerCase();
    let score = 0;

    if (preferredPrefixes.some((prefix) => languageCode.startsWith(prefix))) score += 60;
    if (fallbackPrefixes.some((prefix) => languageCode.startsWith(prefix))) score += 20;
    if (matchesPreferredGender(name, preferred)) score += 15;
    if (quality.includes('enhanced') || quality.includes('premium')) score += 20;
    if (quality.includes('default')) score += 5;

    return { voice, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.voice?.identifier;
}

export async function speakText(text: string, onDone?: () => void): Promise<void> {
  const settings = await loadTTSSettings();
  await speakTextWithSettings(settings, text, onDone);
}

export async function speakTextWithSettings(settings: TTSSettings, text: string, onDone?: () => void): Promise<void> {
  const rate = READING_SPEEDS[settings.speed];
  const language = settings.language === 'spanish' ? 'es-ES' : 'en-US';
  const voice = await getBestVoiceIdentifier(settings.language, settings.voice);

  console.log('[TTS] Speaking text', {
    length: text.length,
    rate,
    voicePreference: settings.voice,
    resolvedVoice: voice,
    language,
  });

  await Speech.stop();

  const options: Speech.SpeechOptions = {
    rate,
    language,
    pitch: 1.0,
    voice,
    onDone: () => {
      console.log('[TTS] Speech done');
      onDone?.();
    },
    onError: (err) => {
      console.error('[TTS] Speech error', err);
      onDone?.();
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
