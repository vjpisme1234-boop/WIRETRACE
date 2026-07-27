import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

export type VisualMode = 'normalLight' | 'highContrast' | 'detailedSymbols';
export type LayoutPreset = 'industrial' | 'residential' | 'commercial';
export type VisionProviderPreference = 'all' | 'openrouter' | 'openai' | 'groq';

export interface UIPreferences {
  visualMode: VisualMode;
  layoutPreset: LayoutPreset;
  visionProvider: VisionProviderPreference;
}

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  visualMode: 'normalLight',
  layoutPreset: 'industrial',
  visionProvider: 'all',
};

const LEGACY_VISUAL_MODE_MAP: Record<string, VisualMode> = {
  light: 'normalLight',
  highlight: 'highContrast',
  symbols: 'detailedSymbols',
};

function normalizeVisualMode(value: unknown): VisualMode {
  if (value === 'normalLight' || value === 'highContrast' || value === 'detailedSymbols') {
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

  function normalizeVisionProvider(value: unknown): VisionProviderPreference {
    if (value === 'all' || value === 'openrouter' || value === 'openai' || value === 'groq') {
      return value;
    }
    return DEFAULT_UI_PREFERENCES.visionProvider;
  }
  return DEFAULT_UI_PREFERENCES.layoutPreset;
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
    };
  } catch (error) {
    console.error('[UI Preferences] Failed to load preferences', error);
    return DEFAULT_UI_PREFERENCES;
  }
}

export async function saveUIPreferences(prefs: UIPreferences): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.UI_PREFS, JSON.stringify(prefs));
}
