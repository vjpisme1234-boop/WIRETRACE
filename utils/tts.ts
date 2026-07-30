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

/** Higher-quality voices (iOS Enhanced/Premium, Android Neural/WaveNet) sound
 * meaningfully more human than a device's compact default voice — this is
 * the single biggest lever available via on-device TTS. */
function isHighQualityVoice(quality: string): boolean {
  return /(enhanced|premium|neural|wavenet|natural)/.test(quality);
}

async function getBestVoiceIdentifier(language: 'english' | 'spanish', preferred: TTSSettings['voice']): Promise<string | undefined> {
  const voices = await getAvailableVoices();
  if (voices.length === 0) return undefined;

  const exactPrefixes = language === 'spanish' ? ['es-', 'es_'] : ['en-', 'en_'];
  const broadPrefixes = language === 'spanish' ? ['es'] : ['en'];

  const exactLangVoices = voices.filter((v) => exactPrefixes.some((p) => String(v.language || '').toLowerCase().startsWith(p)));
  const broadLangVoices = voices.filter((v) => broadPrefixes.some((p) => String(v.language || '').toLowerCase().startsWith(p)));
  const languagePool = exactLangVoices.length > 0 ? exactLangVoices : broadLangVoices.length > 0 ? broadLangVoices : voices;

  const genderPool = preferred !== 'default' ? languagePool.filter((v) => matchesPreferredGender(String(v.name || ''), preferred)) : languagePool;
  const finalPool = genderPool.length > 0 ? genderPool : languagePool;

  const scored = finalPool.map((voice) => {
    const quality = String(voice.quality || '').toLowerCase();
    return { voice, score: isHighQualityVoice(quality) ? 1 : 0 };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.voice?.identifier;
}

/** Splits text into sentence-sized chunks so pauses can be inserted between
 * them — an unbroken TTS paragraph reads as a robotic run-on, while a short
 * breath between sentences is one of the simplest ways to sound more human. */
function splitIntoSpeechChunks(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map((s) => s.trim()).filter(Boolean);
}

const SENTENCE_PAUSE_MS = 220;

let speechSessionId = 0;

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
  const sessionId = ++speechSessionId;

  const baseOptions: Speech.SpeechOptions = { rate, language, pitch: 1.0, voice };
  const chunks = splitIntoSpeechChunks(text);

  const speakChunk = (index: number) => {
    if (sessionId !== speechSessionId) return;
    if (index >= chunks.length) {
      console.log('[TTS] Speech done');
      onDone?.();
      return;
    }
    Speech.speak(chunks[index], {
      ...baseOptions,
      onDone: () => {
        if (sessionId !== speechSessionId) return;
        if (index + 1 >= chunks.length) {
          console.log('[TTS] Speech done');
          onDone?.();
        } else {
          setTimeout(() => speakChunk(index + 1), SENTENCE_PAUSE_MS);
        }
      },
      onError: (err) => {
        console.error('[TTS] Speech error', err);
        if (sessionId === speechSessionId) onDone?.();
      },
    });
  };

  speakChunk(0);
}

export async function stopSpeech(): Promise<void> {
  console.log('[TTS] Stopping speech');
  speechSessionId += 1;
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
