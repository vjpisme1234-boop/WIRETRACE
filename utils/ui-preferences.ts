import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

export type VisualMode = 'normalLight' | 'highContrast' | 'detailedSymbols';
export type LayoutPreset = 'industrial' | 'residential' | 'commercial';

export interface UIPreferences {
  visualMode: VisualMode;
  layoutPreset: LayoutPreset;
}

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  visualMode: 'normalLight',
  layoutPreset: 'industrial',
};

export async function loadUIPreferences(): Promise<UIPreferences> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.UI_PREFS);
    if (!raw) return DEFAULT_UI_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UIPreferences>;
    return {
      visualMode: parsed.visualMode ?? DEFAULT_UI_PREFERENCES.visualMode,
      layoutPreset: parsed.layoutPreset ?? DEFAULT_UI_PREFERENCES.layoutPreset,
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export async function saveUIPreferences(prefs: UIPreferences): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.UI_PREFS, JSON.stringify(prefs));
}
