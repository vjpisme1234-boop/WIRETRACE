import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

export type VisualMode = 'normalLight' | 'highContrast' | 'dark';
export type LayoutPreset = 'industrial' | 'residential' | 'commercial';
export type VisionProviderPreference = 'all' | 'anthropic' | 'openrouter' | 'openai' | 'gemini';

export interface UIPreferences {
  visualMode: VisualMode;
  layoutPreset: LayoutPreset;
  visionProvider: VisionProviderPreference;
  /** Whether voice-note text is shown as a badge/popup, or stays audio-only (spoken back via TTS). */
  notesVisible: boolean;
  /** When true, wire steps are shown/spoken as just "<wire#> from <point> to <point>" instead of the full AI instruction. */
  briefMode: boolean;
}

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  visualMode: 'normalLight',
  layoutPreset: 'industrial',
  // Default to the free built-in provider explicitly, rather than "Auto",
  // so a fresh install clearly shows an active provider instead of a vague
  // "Auto" state that can read as "nothing is configured." Settings bumps
  // this to 'all' automatically the first time a user adds a paid key.
  visionProvider: 'gemini',
  notesVisible: true,
  briefMode: false,
};

const LEGACY_VISUAL_MODE_MAP: Record<string, VisualMode> = {
  light: 'normalLight',
  highlight: 'highContrast',
  symbols: 'dark',
  detailedsymbols: 'dark',
  dark: 'dark',
};

function normalizeVisualMode(value: unknown): VisualMode {
  if (value === 'normalLight' || value === 'highContrast' || value === 'dark') {
    return value;
  }
  if (typeof value === 'string') {
    const mapped = LEGACY_VISUAL_MODE_MAP[value.toLowerCase()];
    if (mapped) return mapped;
  }
  return DEFAULT_UI_PREFERENCES.visualMode;
}

function normalizeLayoutPreset(value: unknown): LayoutPreset {
  if (value === 'industrial' || value === 'residential' || value === 'commercial') {
    return value;
  }
  return DEFAULT_UI_PREFERENCES.layoutPreset;
}

function normalizeVisionProvider(value: unknown): VisionProviderPreference {
  if (value === 'all' || value === 'anthropic' || value === 'openrouter' || value === 'openai' || value === 'gemini') {
    return value;
  }
  return DEFAULT_UI_PREFERENCES.visionProvider;
}

export async function loadUIPreferences(): Promise<UIPreferences> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.UI_PREFS);
    if (!raw) return DEFAULT_UI_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UIPreferences>;
    return {
      visualMode: normalizeVisualMode(parsed.visualMode),
      layoutPreset: normalizeLayoutPreset(parsed.layoutPreset),
      visionProvider: normalizeVisionProvider(parsed.visionProvider),
      notesVisible: typeof parsed.notesVisible === 'boolean' ? parsed.notesVisible : DEFAULT_UI_PREFERENCES.notesVisible,
      briefMode: typeof parsed.briefMode === 'boolean' ? parsed.briefMode : DEFAULT_UI_PREFERENCES.briefMode,
    };
  } catch (error) {
    console.error('[UI Preferences] Failed to load preferences', error);
    return DEFAULT_UI_PREFERENCES;
  }
}

export async function saveUIPreferences(prefs: UIPreferences): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.UI_PREFS, JSON.stringify(prefs));
}
