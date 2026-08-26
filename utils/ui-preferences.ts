import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

export type VisualMode = 'normalLight' | 'highContrast' | 'dark';
export type LayoutPreset = 'industrial' | 'residential' | 'commercial';
export type VisionProviderPreference = 'all' | 'anthropic' | 'openrouter' | 'openai' | 'gemini';
/**
 * How wire steps are read/shown:
 *  - detailed: the full AI-generated instruction (default)
 *  - brief: "<wire#> from <point> to <point>"
 *  - destinationOnly: "Wire number <wire#> to <point>" (source point omitted)
 */
export type ReadingStyle = 'detailed' | 'brief' | 'destinationOnly';

export interface UIPreferences {
  visualMode: VisualMode;
  layoutPreset: LayoutPreset;
  visionProvider: VisionProviderPreference;
  /** Whether voice-note text is shown as a badge/popup, or stays audio-only (spoken back via TTS). */
  notesVisible: boolean;
  readingStyle: ReadingStyle;
  /**
   * Runs the scan as three narrower passes (components, then topology, then
   * wire numbers) instead of one prompt that has to do all three under a
   * single token ceiling. Slower and more requests per scan, so it stays
   * opt-in until it has field mileage behind it.
   */
  multiPassAnalysis: boolean;
}

export const DEFAULT_UI_PREFERENCES: UIPreferences = {
  // Highlight (high contrast) out of the box. A schematic gets read on a job
  // site in daylight or under bad shop lighting, where the softer mode is the
  // one that loses.
  visualMode: 'highContrast',
  layoutPreset: 'industrial',
  // Default to the free built-in provider explicitly, rather than "Auto",
  // so a fresh install clearly shows an active provider instead of a vague
  // "Auto" state that can read as "nothing is configured." Settings bumps
  // this to 'all' automatically the first time a user adds a paid key.
  visionProvider: 'gemini',
  notesVisible: true,
  readingStyle: 'detailed',
  multiPassAnalysis: false,
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

function normalizeReadingStyle(parsed: Partial<UIPreferences> & { briefMode?: boolean }): ReadingStyle {
  if (parsed.readingStyle === 'detailed' || parsed.readingStyle === 'brief' || parsed.readingStyle === 'destinationOnly') {
    return parsed.readingStyle;
  }
  // Migrate the old boolean brief-mode toggle for users who set it before
  // destinationOnly existed.
  if (typeof parsed.briefMode === 'boolean') {
    return parsed.briefMode ? 'brief' : 'detailed';
  }
  return DEFAULT_UI_PREFERENCES.readingStyle;
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
      readingStyle: normalizeReadingStyle(parsed),
      multiPassAnalysis:
        typeof parsed.multiPassAnalysis === 'boolean' ? parsed.multiPassAnalysis : DEFAULT_UI_PREFERENCES.multiPassAnalysis,
    };
  } catch (error) {
    console.error('[UI Preferences] Failed to load preferences', error);
    return DEFAULT_UI_PREFERENCES;
  }
}

export async function saveUIPreferences(prefs: UIPreferences): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.UI_PREFS, JSON.stringify(prefs));
}
