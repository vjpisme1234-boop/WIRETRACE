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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowLeft, CheckCircle, Info, Key, Mic, Zap } from 'lucide-react-native';
import { WT, OPENROUTER_API_KEY, STORAGE_KEYS } from '@/constants/wiretrace';
import { loadTTSSettings, saveTTSSettings, TTSSettings } from '@/utils/tts';

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
  const [apiKey, setApiKey] = useState(OPENROUTER_API_KEY);
  const [settings, setSettings] = useState<TTSSettings>({
    speed: 'normal',
    voice: 'default',
    autoAdvanceDelay: 'off',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      console.log('[Settings] Loading settings');
      const [storedKey, ttsSettings] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.API_KEY),
        loadTTSSettings(),
      ]);
      if (storedKey) setApiKey(storedKey);
      setSettings(ttsSettings);
    };
    load();
  }, []);

  const handleSave = async () => {
    console.log('[Settings] Save button pressed');
    try {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.API_KEY, apiKey),
        saveTTSSettings(settings),
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
        <Text style={styles.headerTitle}>Settings</Text>
        <AnimatedPressable onPress={handleSave} style={styles.saveBtn} scaleValue={0.9}>
          {saved ? (
            <CheckCircle size={20} color={WT.green} />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </AnimatedPressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* API Key */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Key size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>OpenRouter API Key</Text>
          </View>
          <Text style={styles.fieldLabel}>API Key</Text>
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
            secureTextEntry={false}
            multiline={false}
          />
          <Text style={styles.fieldHint}>
            Used for AI schematic analysis. Get your key at openrouter.ai
          </Text>
        </View>

        {/* Reading Speed */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Zap size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>Reading Speed</Text>
          </View>
          <SegmentControl
            options={['slow', 'normal', 'fast'] as TTSSettings['speed'][]}
            value={settings.speed}
            onChange={(v) => {
              console.log('[Settings] Reading speed changed', { speed: v });
              updateSettings({ speed: v });
            }}
            labels={{ slow: 'Slow', normal: 'Normal', fast: 'Fast' }}
          />
        </View>

        {/* Auto-advance */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Zap size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>Auto-Advance Delay</Text>
          </View>
          <Text style={styles.fieldHint}>
            Automatically advance to the next step after speech ends
          </Text>
          <SegmentControl
            options={['off', '3s', '5s', '10s'] as TTSSettings['autoAdvanceDelay'][]}
            value={settings.autoAdvanceDelay}
            onChange={(v) => {
              console.log('[Settings] Auto-advance delay changed', { delay: v });
              updateSettings({ autoAdvanceDelay: v });
            }}
            labels={{ off: 'Off', '3s': '3 sec', '5s': '5 sec', '10s': '10 sec' }}
          />
        </View>

        {/* Voice */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Mic size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>Voice</Text>
          </View>
          <SegmentControl
            options={['default', 'male', 'female'] as TTSSettings['voice'][]}
            value={settings.voice}
            onChange={(v) => {
              console.log('[Settings] Voice changed', { voice: v });
              updateSettings({ voice: v });
            }}
            labels={{ default: 'Default', male: 'Male', female: 'Female' }}
          />
          <Text style={styles.fieldHint}>
            Voice availability depends on your device's installed voices
          </Text>
        </View>

        {/* About */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Info size={16} color={WT.blue} />
            <Text style={styles.sectionTitle}>About WireTrace AI</Text>
          </View>
          <View style={styles.aboutCard}>
            <Text style={styles.aboutTitle}>WireTrace AI</Text>
            <Text style={styles.aboutVersion}>Version 1.0.0</Text>
            <Text style={styles.aboutDesc}>
              AI-powered wire schematic reader for electricians and technicians. Photograph any wire diagram and get step-by-step audio guidance.
            </Text>
            <View style={styles.aboutDivider} />
            <Text style={styles.aboutModel}>
              {'AI Model: '}
              <Text style={styles.aboutModelName}>Google Gemini 2.0 Flash</Text>
            </Text>
            <Text style={styles.aboutPowered}>Powered by OpenRouter</Text>
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
