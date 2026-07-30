// WireTrace AI — App Constants

export const OPENROUTER_MODEL = 'google/gemini-2.5-flash';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const STORAGE_KEYS = {
  SCHEMATICS: 'wiretrace_schematics',
  API_KEY: 'wiretrace_api_key',
  OPENAI_API_KEY: 'wiretrace_openai_api_key',
  ANTHROPIC_API_KEY: 'wiretrace_anthropic_api_key',
  SETTINGS: 'wiretrace_settings',
  UI_PREFS: 'wiretrace_ui_prefs',
} as const;

export const WT = {
  // Backgrounds
  bg: '#0A0A0F',
  bgCard: '#12121A',
  bgCardAlt: '#1A1A26',
  bgInput: '#1E1E2E',

  // Accent
  blue: '#00B4FF',
  blueMuted: 'rgba(0,180,255,0.12)',
  blueDim: 'rgba(0,180,255,0.25)',

  // Status
  yellow: '#FFD60A',
  yellowMuted: 'rgba(255,214,10,0.12)',
  green: '#34C759',
  greenMuted: 'rgba(52,199,89,0.12)',
  red: '#FF3B30',
  redMuted: 'rgba(255,59,48,0.12)',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#48484A',

  // Borders
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
} as const;

export const SYMBOL_TYPES = [
  'Transformer',
  'Resistor',
  'Capacitor',
  'Diode',
  'Relay',
  'Fuse',
  'Switch',
  'Motor',
  'Terminal',
  'Ground',
  'Power Supply',
  'Solenoid',
  'Sensor',
  'PLC',
  'VFD',
  'Circuit Breaker',
  'Contactor',
  'Overload',
] as const;

export const READING_SPEEDS = {
  slow: 0.6,
  normal: 0.9,
  fast: 1.3,
} as const;
