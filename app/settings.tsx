import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { ArrowLeft, CheckCircle, Info, Key, Mic, Zap } from 'lucide-react-native';
import { WT, STORAGE_KEYS } from '@/constants/wiretrace';
import { loadTTSSettings, saveTTSSettings, speakTextWithSettings, stopSpeech, TTSSettings } from '@/utils/tts';
import { DEFAULT_UI_PREFERENCES, LayoutPreset, loadUIPreferences, saveUIPreferences, UIPreferences, VisualMode, VisionProviderPreference } from '@/utils/ui-preferences';

function AnimatedPressable({
  onPress,
  style,
  children,
  scaleValue = 0.97,
}: {
  onPress?: () => void;
  style?: object | object[];
  children: React.ReactNode;
  scaleValue?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animIn = () =>
    Animated.spring(scale, { toValue: scaleValue, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const animOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function SegmentControl<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Record<T, string>;
}) {
  return (
    <View style={segStyles.container}>
      {options.map((opt) => {
        const isActive = value === opt;
        const label = labels ? labels[opt] : opt;
        return (
          <AnimatedPressable
            key={opt}
            onPress={() => onChange(opt)}
            style={[segStyles.seg, isActive && segStyles.segActive]}
            scaleValue={0.95}
          >
            <Text style={[segStyles.segText, isActive && segStyles.segTextActive]}>
              {label}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const segStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: WT.bgCardAlt,
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  seg: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segActive: {
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
  },
  segText: {
    fontSize: 13,
    fontWeight: '500',
    color: WT.textSecondary,
  },
  segTextActive: {
    color: WT.textPrimary,
    fontWeight: '600',
  },
});

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [apiKey, setApiKey] = useState('');
  const [openAIApiKey, setOpenAIApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [settings, setSettings] = useState<TTSSettings>({
    speed: 'normal',
    voice: 'default',
    autoAdvanceDelay: 'off',
    language: 'english',
  });
  const [uiPrefs, setUiPrefs] = useState<UIPreferences>(DEFAULT_UI_PREFERENCES);
  const [saved, setSaved] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);

  useEffect(() => {
    const load = async () => {
      console.log('[Settings] Loading settings');
      const [storedKey, storedOpenAIKey, storedAnthropicKey, ttsSettings, storedUiPrefs] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
        SecureStore.getItemAsync(STORAGE_KEYS.OPENAI_API_KEY),
        SecureStore.getItemAsync(STORAGE_KEYS.ANTHROPIC_API_KEY),
        loadTTSSettings(),
        loadUIPreferences(),
      ]);
      if (storedKey) setApiKey(storedKey);
      if (storedOpenAIKey) setOpenAIApiKey(storedOpenAIKey);
      if (storedAnthropicKey) setAnthropicApiKey(storedAnthropicKey);
      setSettings(ttsSettings);
      setUiPrefs(storedUiPrefs);
    };
    load();
  }, []);

  const handleSave = async () => {
    console.log('[Settings] Save button pressed');
    try {
      const openRouterKey = apiKey.trim();
      const openAIKey = openAIApiKey.trim();
      const anthropicKey = anthropicApiKey.trim();
      await Promise.all([
        openRouterKey
          ? SecureStore.setItemAsync(STORAGE_KEYS.API_KEY, openRouterKey)
          : SecureStore.deleteItemAsync(STORAGE_KEYS.API_KEY),
        openAIKey
          ? SecureStore.setItemAsync(STORAGE_KEYS.OPENAI_API_KEY, openAIKey)
          : SecureStore.deleteItemAsync(STORAGE_KEYS.OPENAI_API_KEY),
        anthropicKey
          ? SecureStore.setItemAsync(STORAGE_KEYS.ANTHROPIC_API_KEY, anthropicKey)
          : SecureStore.deleteItemAsync(STORAGE_KEYS.ANTHROPIC_API_KEY),
        saveTTSSettings(settings),
        saveUIPreferences(uiPrefs),
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      console.log('[Settings] Settings saved successfully');
    } catch (e) {
      console.error('[Settings] Save failed', e);
    }
  };

  const updateSettings = (patch: Partial<TTSSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const updateUiPrefs = (patch: Partial<UIPreferences>) => {
    setUiPrefs((prev) => ({ ...prev, ...patch }));
  };

  const es = settings.language === 'spanish';

  const handleTestVoice = async () => {
    if (testingVoice) {
      await stopSpeech();
      setTestingVoice(false);
      return;
    }

    setTestingVoice(true);
    const sample =
      settings.language === 'spanish'
        ? 'Prueba de voz de WireTrace. Di siguiente para continuar.'
        : 'WireTrace voice test. Say next to continue.';

    await speakTextWithSettings(settings, sample, () => {
      setTestingVoice(false);
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable onPress={() => {
          console.log('[Settings] Back button pressed');
          router.back();
        }} style={styles.backBtn} scaleValue={0.9}>
          <ArrowLeft size={22} color={WT.blue} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>{es ? 'Ajustes' : 'Settings'}</Text>
        <AnimatedPressable onPress={handleSave} style={styles.saveBtn} scaleValue={0.9}>
          {saved ? (
            <CheckCircle size={20} color={WT.green} />
          ) : (
            <Text style={styles.saveBtnText}>{es ? 'Guardar' : 'Save'}</Text>
          )}
        </AnimatedPressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Free AI banner */}
        <View style={styles.freeAiBanner}>
          <Zap size={18} color={WT.green} fill={WT.green} />
          <Text style={styles.freeAiBannerText}>
            {es
              ? 'WireTrace AI funciona de inmediato con una AI gratuita integrada (Groq). Agrega tus propias claves abajo para usar una AI de mayor calidad.'
              : 'WireTrace AI works out of the box with a free built-in AI (Groq). Add your own keys below to use a higher-quality AI.'}
          </Text>
        </View>

        {/* OpenRouter API Key */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Key size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Clave API de OpenRouter' : 'OpenRouter API Key'}</Text>
          </View>
          <Text style={styles.fieldLabel}>{es ? 'Clave API' : 'API Key'}</Text>
          <TextInput
            style={styles.apiKeyInput}
            value={apiKey}
            onChangeText={(t) => {
              console.log('[Settings] API key changed');
              setApiKey(t);
            }}
            placeholder="sk-or-v1-..."
            placeholderTextColor={WT.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={true}
            multiline={false}
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'Acceso flexible a Gemini, Claude, GPT y más con una sola clave. Pago por uso.'
              : 'Flexible access to Gemini, Claude, GPT, and more through one key. Pay-as-you-go.'}
          </Text>
          <Text style={styles.fieldHint}>
            {es
              ? '1) Ve a openrouter.ai y crea una cuenta.  2) Ve a Settings → API Keys y crea una nueva clave.  3) Agrega crédito en Settings → Credits.  4) Pega la clave arriba y toca Guardar.'
              : '1) Go to openrouter.ai and create an account.  2) Go to Settings → API Keys and create a new key.  3) Add credit under Settings → Credits.  4) Paste the key above and tap Save.'}
          </Text>
        </View>

        {/* OpenAI API Key */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Key size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Clave API de OpenAI' : 'OpenAI API Key'}</Text>
          </View>
          <Text style={styles.fieldLabel}>{es ? 'Clave API' : 'API Key'}</Text>
          <TextInput
            style={styles.apiKeyInput}
            value={openAIApiKey}
            onChangeText={(t) => {
              console.log('[Settings] OpenAI API key changed');
              setOpenAIApiKey(t);
            }}
            placeholder="sk-..."
            placeholderTextColor={WT.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={true}
            multiline={false}
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'GPT-4o: muy confiable extrayendo datos estructurados de fotos de esquemas.'
              : 'GPT-4o: very reliable at extracting structured data from schematic photos.'}
          </Text>
          <Text style={styles.fieldHint}>
            {es
              ? '1) Ve a platform.openai.com y crea una cuenta.  2) Ve a Settings → Billing y agrega un método de pago.  3) Ve a API Keys y crea una nueva clave.  4) Pega la clave arriba y toca Guardar.'
              : '1) Go to platform.openai.com and create an account.  2) Go to Settings → Billing and add a payment method.  3) Go to API Keys and create a new key.  4) Paste the key above and tap Save.'}
          </Text>
        </View>

        {/* Anthropic API Key */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Key size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Clave API de Anthropic (Claude)' : 'Anthropic (Claude) API Key'}</Text>
          </View>
          <Text style={styles.fieldLabel}>{es ? 'Clave API' : 'API Key'}</Text>
          <TextInput
            style={styles.apiKeyInput}
            value={anthropicApiKey}
            onChangeText={(t) => {
              console.log('[Settings] Anthropic API key changed');
              setAnthropicApiKey(t);
            }}
            placeholder="sk-ant-..."
            placeholderTextColor={WT.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={true}
            multiline={false}
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'Claude: a menudo la más precisa siguiendo instrucciones detalladas al leer esquemas.'
              : "Claude: often the most accurate at following detailed instructions when reading schematics."}
          </Text>
          <Text style={styles.fieldHint}>
            {es
              ? '1) Ve a console.anthropic.com y crea una cuenta.  2) Ve a Billing y agrega crédito.  3) Ve a API Keys y crea una nueva clave.  4) Pega la clave arriba y toca Guardar.'
              : '1) Go to console.anthropic.com and create an account.  2) Go to Billing and add credit.  3) Go to API Keys and create a new key.  4) Paste the key above and tap Save.'}
          </Text>
        </View>

        {/* Reading Speed */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Zap size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Velocidad de Lectura' : 'Reading Speed'}</Text>
          </View>
          <SegmentControl
            options={['slow', 'normal', 'fast'] as TTSSettings['speed'][]}
            value={settings.speed}
            onChange={(v) => {
              console.log('[Settings] Reading speed changed', { speed: v });
              updateSettings({ speed: v });
            }}
            labels={es ? { slow: 'Lenta', normal: 'Normal', fast: 'Rápida' } : { slow: 'Slow', normal: 'Normal', fast: 'Fast' }}
          />
        </View>

        {/* Auto-advance */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Zap size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Avance Automático' : 'Auto-Advance Delay'}</Text>
          </View>
          <Text style={styles.fieldHint}>
            {es ? 'Avanza automáticamente al siguiente paso cuando termina la voz' : 'Automatically advance to the next step after speech ends'}
          </Text>
          <SegmentControl
            options={['off', '3s', '5s', '10s'] as TTSSettings['autoAdvanceDelay'][]}
            value={settings.autoAdvanceDelay}
            onChange={(v) => {
              console.log('[Settings] Auto-advance delay changed', { delay: v });
              updateSettings({ autoAdvanceDelay: v });
            }}
            labels={es ? { off: 'Apagado', '3s': '3 seg', '5s': '5 seg', '10s': '10 seg' } : { off: 'Off', '3s': '3 sec', '5s': '5 sec', '10s': '10 sec' }}
          />
        </View>

        {/* Voice */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Mic size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Voz' : 'Voice'}</Text>
          </View>
          <SegmentControl
            options={['default', 'male', 'female'] as TTSSettings['voice'][]}
            value={settings.voice}
            onChange={(v) => {
              console.log('[Settings] Voice changed', { voice: v });
              updateSettings({ voice: v });
            }}
            labels={es ? { default: 'Predeterminada', male: 'Masculina', female: 'Femenina' } : { default: 'Default', male: 'Male', female: 'Female' }}
          />
          <Text style={styles.fieldHint}>
            {es ? 'La disponibilidad de voces depende de las voces instaladas en tu dispositivo' : "Voice availability depends on your device's installed voices"}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Mic size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Idioma de la App' : 'App Language'}</Text>
          </View>
          <SegmentControl
            options={['english', 'spanish'] as TTSSettings['language'][]}
            value={settings.language}
            onChange={(v) => {
              console.log('[Settings] App language changed', { language: v });
              updateSettings({ language: v });
            }}
            labels={{ english: 'English', spanish: 'Español' }}
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'Controla el idioma de voz, reconocimiento de voz y todo el texto de la app.'
              : 'Controls the read-aloud voice, voice command recognition, and all app text.'}
          </Text>
          <AnimatedPressable onPress={handleTestVoice} style={styles.testVoiceBtn} scaleValue={0.95}>
            <Text style={styles.testVoiceBtnText}>
              {testingVoice
                ? es
                  ? 'Detener prueba de voz'
                  : 'Stop Voice Test'
                : es
                ? 'Probar voz'
                : 'Test Voice'}
            </Text>
          </AnimatedPressable>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Guía de Comandos de Voz' : 'Voice Commands Guide'}</Text>
          </View>
          <View style={styles.voiceGuideCard}>
            <Text style={styles.voiceGuideText}>
              {es
                ? 'Después de leer cada paso en voz alta, WireTrace se pausa y escucha tu comando.'
                : 'After each step is read aloud, WireTrace pauses and listens for your command.'}
            </Text>
            <Text style={styles.voiceGuideCommand}>
              {es ? '• Di "siguiente" para continuar al siguiente paso' : '• Say "next" to continue to the next step'}
            </Text>
            <Text style={styles.voiceGuideCommand}>
              {es ? '• Di "regresa" para retroceder un paso' : '• Say "go back" to move back one step'}
            </Text>
            <Text style={styles.voiceGuideCommand}>
              {es
                ? '• Di "ayuda" para hacer una pregunta a la AI por voz, luego di tu pregunta'
                : '• Say "help" to ask an AI question by voice, then speak your question'}
            </Text>
            <Text style={styles.voiceGuideCommand}>
              {es ? '• Di "repite" para escuchar el paso actual otra vez' : '• Say "repeat" to hear the current step again'}
            </Text>
            <Text style={styles.voiceGuideText}>
              {es
                ? 'El modo inglés usa: "next", "go back", "help" y "repeat".'
                : 'Spanish mode uses: "siguiente", "regresa", "ayuda", and "repite".'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Modo Visual de la Interfaz' : 'UI Visual Mode'}</Text>
          </View>
          <SegmentControl
            options={['normalLight', 'highContrast', 'dark'] as VisualMode[]}
            value={uiPrefs.visualMode}
            onChange={(v) => {
              console.log('[Settings] Visual mode changed', { visualMode: v });
              updateUiPrefs({ visualMode: v });
            }}
            labels={
              es
                ? { normalLight: 'Claro', highContrast: 'Resaltado', dark: 'Oscuro' }
                : { normalLight: 'Light', highContrast: 'Highlight', dark: 'Dark' }
            }
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'Elige un modo visual para mejorar la legibilidad en distintas condiciones de luz.'
              : 'Choose a visual mode for readability in different lighting conditions.'}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Proveedor de Visión AI' : 'AI Vision Provider'}</Text>
          </View>
          <SegmentControl
            options={['all', 'openrouter', 'anthropic', 'openai', 'groq'] as VisionProviderPreference[]}
            value={uiPrefs.visionProvider}
            onChange={(v) => {
              console.log('[Settings] Vision provider preference changed', { visionProvider: v });
              updateUiPrefs({ visionProvider: v });
            }}
            labels={
              es
                ? { all: 'Auto', openrouter: 'OpenRouter', anthropic: 'Claude', openai: 'OpenAI', groq: 'Groq (gratis)' }
                : { all: 'Auto', openrouter: 'OpenRouter', anthropic: 'Claude', openai: 'OpenAI', groq: 'Groq (free)' }
            }
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'Auto usa tus claves pagadas primero y Groq gratis como respaldo. Un solo proveedor fuerza solo esa AI.'
              : 'Auto uses your paid keys first and free Groq as a fallback. Single provider forces only that AI.'}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Diseño y Preajuste de Herramientas' : 'Layout & Tool Preset'}</Text>
          </View>
          <SegmentControl
            options={['industrial', 'residential', 'commercial'] as LayoutPreset[]}
            value={uiPrefs.layoutPreset}
            onChange={(v) => {
              console.log('[Settings] Layout preset changed', { layoutPreset: v });
              updateUiPrefs({ layoutPreset: v });
            }}
            labels={
              es
                ? { industrial: 'Industrial', residential: 'Residencial', commercial: 'Comercial' }
                : { industrial: 'Industrial', residential: 'Residential', commercial: 'Commercial' }
            }
          />
          <Text style={styles.fieldHint}>
            {es
              ? 'Selecciona un diseño de flujo de trabajo para cableado industrial, residencial o comercial.'
              : 'Select a workflow layout tuned for industrial wiring, residential, or commercial jobs.'}
          </Text>
        </View>

        {/* About */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>{es ? 'Acerca de WireTrace AI' : 'About WireTrace AI'}</Text>
          </View>
          <View style={styles.aboutCard}>
            <Text style={styles.aboutTitle}>WireTrace AI</Text>
            <Text style={styles.aboutVersion}>{es ? 'Versión 1.0.0' : 'Version 1.0.0'}</Text>
            <Text style={styles.aboutDesc}>
              {es
                ? 'Lector de esquemas de cableado con AI para electricistas y técnicos. Fotografía cualquier diagrama de cableado y obtén guía de audio paso a paso.'
                : 'AI-powered wire schematic reader for electricians and technicians. Photograph any wire diagram and get step-by-step audio guidance.'}
            </Text>
            <View style={styles.aboutDivider} />
            <Text style={styles.aboutModel}>
              {es ? 'Modelo AI: ' : 'AI Model: '}
              <Text style={styles.aboutModelName}>Claude Sonnet 4.5, OpenAI, and Groq</Text>
            </Text>
            <Text style={styles.aboutPowered}>{es ? 'Impulsado por múltiples proveedores de visión' : 'Powered by multiple vision providers'}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  saveBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: WT.blue,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 20,
  },
  freeAiBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: WT.greenMuted,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(52,199,89,0.25)',
  },
  freeAiBannerText: {
    flex: 1,
    fontSize: 13,
    color: WT.textPrimary,
    lineHeight: 19,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: WT.textSecondary,
  },
  fieldHint: {
    fontSize: 12,
    color: WT.textTertiary,
    lineHeight: 17,
  },
  voiceGuideCard: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: WT.border,
    padding: 12,
    gap: 8,
  },
  voiceGuideText: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 19,
  },
  voiceGuideCommand: {
    fontSize: 13,
    color: WT.textPrimary,
    lineHeight: 19,
  },
  testVoiceBtn: {
    marginTop: 6,
    backgroundColor: WT.bgCardAlt,
    borderWidth: 1,
    borderColor: WT.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  testVoiceBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  apiKeyInput: {
    backgroundColor: WT.bgInput,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 13,
    color: WT.textPrimary,
    borderWidth: 1,
    borderColor: WT.border,
    fontFamily: 'SpaceMono',
  },
  aboutCard: {
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 6,
  },
  aboutTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  aboutVersion: {
    fontSize: 12,
    color: WT.textTertiary,
  },
  aboutDesc: {
    fontSize: 14,
    color: WT.textSecondary,
    lineHeight: 20,
    marginTop: 4,
  },
  aboutDivider: {
    height: 1,
    backgroundColor: WT.border,
    marginVertical: 4,
  },
  aboutModel: {
    fontSize: 13,
    color: WT.textSecondary,
  },
  aboutModelName: {
    color: WT.blue,
    fontWeight: '600',
  },
  aboutPowered: {
    fontSize: 12,
    color: WT.textTertiary,
  },
});
