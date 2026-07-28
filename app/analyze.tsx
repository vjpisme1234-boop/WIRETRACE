import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Highlighter,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  Zap,
} from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import { analyzeSchematic, analyzeMultipleImages, AnalysisResult } from '@/utils/openrouter';
import {
  generateSchematicName,
  getSchematic,
  saveSchematic,
  SchematicAnalysis,
  WireInfo,
  ComponentInfo,
  Connection,
  UnknownSymbol,
} from '@/utils/schematic-storage';
import { DEFAULT_UI_PREFERENCES, loadUIPreferences } from '@/utils/ui-preferences';

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: '' };
  if (typeof source === 'string') return { uri: source };
  return source as ImageSourcePropType;
}

function AnimatedPressable({
  onPress,
  style,
  children,
  scaleValue = 0.97,
  disabled,
}: {
  onPress?: () => void;
  style?: object | object[];
  children: React.ReactNode;
  scaleValue?: number;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animIn = () =>
    Animated.spring(scale, { toValue: scaleValue, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const animOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  return (
    <Animated.View style={[{ transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} disabled={disabled} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function SkeletonLine({ width, height = 14 }: { width: number | string; height?: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: WT.bgCardAlt,
        },
        typeof width === 'number' ? { width } : { width: width as `${number}%` },
        { opacity },
      ]}
    />
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <SkeletonLine width="40%" height={13} />
      <View style={{ height: 10 }} />
      <SkeletonLine width="90%" />
      <View style={{ height: 6 }} />
      <SkeletonLine width="75%" />
      <View style={{ height: 6 }} />
      <SkeletonLine width="60%" />
    </View>
  );
}

type ReadingDirection = 'forward' | 'backward';
type StartPoint = 'beginning' | 'end' | 'specific';

export default function AnalyzeScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ imageUri?: string; imageUris?: string; schematicId?: string }>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schematic, setSchematic] = useState<SchematicAnalysis | null>(null);

  const [direction, setDirection] = useState<ReadingDirection>('forward');
  const [startPoint, setStartPoint] = useState<StartPoint>('beginning');
  const [specificStart, setSpecificStart] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [generatingSteps, setGeneratingSteps] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [askingAi, setAskingAi] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [uiPrefs, setUiPrefs] = useState(DEFAULT_UI_PREFERENCES);
  const [language, setLanguage] = useState<AppLanguage>('english');
  const es = isSpanish(language);

  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      ])
    );
    if (loading) pulse.start();
    else pulse.stop();
    return () => pulse.stop();
  }, [loading, pulseAnim]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      loadUIPreferences()
        .then((prefs) => {
          if (isMounted) setUiPrefs(prefs);
        })
        .catch((error) => {
          console.error('[Analyze] Failed to refresh UI preferences', error);
        });
      loadAppLanguage()
        .then((lang) => {
          if (isMounted) setLanguage(lang);
        })
        .catch((error) => {
          console.error('[Analyze] Failed to load app language', error);
        });
      return () => {
        isMounted = false;
      };
    }, [])
  );

  const runAnalysis = useCallback(async (imageUri: string) => {
    setLoading(true);
    setError(null);
    console.log('[Analyze] Starting schematic analysis', { imageUri });

    try {
      console.log('[Analyze] Reading image as base64');
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log('[Analyze] Calling OpenRouter analyzeSchematic');
      const result: AnalysisResult = await analyzeSchematic(base64);

      const newSchematic: SchematicAnalysis = {
        id: `sch_${Date.now()}`,
        imageUri,
        analyzedAt: new Date().toISOString(),
        name: generateSchematicName(),
        summary: result.summary,
        wireCount: result.wires?.length ?? 0,
        componentCount: result.components?.length ?? 0,
        wires: (result.wires ?? []).map((w) => ({ ...w } as WireInfo)),
        components: (result.components ?? []).map((c) => ({ ...c } as ComponentInfo)),
        connections: (result.connections ?? []).map((c) => ({ ...c } as Connection)),
        unknownSymbols: (result.unknownSymbols ?? []).map((u) => ({ ...u } as UnknownSymbol)),
        readingSteps: [],
      };

      await saveSchematic(newSchematic);
      setSchematic(newSchematic);
      console.log('[Analyze] Analysis complete', { id: newSchematic.id, wires: newSchematic.wireCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'El análisis falló' : 'Analysis failed';
      console.error('[Analyze] Analysis error', e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [es]);

  const runMultiAnalysis = useCallback(async (imageUris: string[]) => {
    setLoading(true);
    setError(null);
    console.log('[Analyze] Starting multi-page analysis', { pageCount: imageUris.length });

    try {
      console.log('[Analyze] Reading all images as base64');
      const base64Images = await Promise.all(
        imageUris.map((uri) =>
          FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
        )
      );

      console.log('[Analyze] Calling OpenRouter analyzeMultipleImages');
      const result: AnalysisResult = await analyzeMultipleImages(base64Images);

      const newSchematic: SchematicAnalysis = {
        id: `sch_${Date.now()}`,
        imageUri: imageUris[0],
        analyzedAt: new Date().toISOString(),
        name: generateSchematicName(),
        summary: result.summary,
        wireCount: result.wires?.length ?? 0,
        componentCount: result.components?.length ?? 0,
        wires: (result.wires ?? []).map((w) => ({ ...w } as WireInfo)),
        components: (result.components ?? []).map((c) => ({ ...c } as ComponentInfo)),
        connections: (result.connections ?? []).map((c) => ({ ...c } as Connection)),
        unknownSymbols: (result.unknownSymbols ?? []).map((u) => ({ ...u } as UnknownSymbol)),
        readingSteps: [],
      };

      await saveSchematic(newSchematic);
      setSchematic(newSchematic);
      console.log('[Analyze] Multi-page analysis complete', { id: newSchematic.id, wires: newSchematic.wireCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'El análisis falló' : 'Analysis failed';
      console.error('[Analyze] Multi-page analysis error', e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [es]);

  useEffect(() => {
    if (params.schematicId) {
      console.log('[Analyze] Loading existing schematic', { id: params.schematicId });
      getSchematic(params.schematicId).then((s) => {
        if (s) setSchematic(s);
        else setError(es ? 'Esquema no encontrado' : 'Schematic not found');
      });
    } else if (params.imageUris) {
      const uris = JSON.parse(params.imageUris as string) as string[];
      console.log('[Analyze] Multi-page URIs received', { count: uris.length });
      runMultiAnalysis(uris);
    } else if (params.imageUri) {
      runAnalysis(params.imageUri);
    }
  }, [params.imageUri, params.imageUris, params.schematicId, runAnalysis, runMultiAnalysis]);

  const handleStartReading = async () => {
    if (!schematic) return;
    console.log('[Analyze] Start Reading pressed', { direction, startPoint, specificStart });

    const startLabel =
      startPoint === 'beginning'
        ? 'Line 1'
        : startPoint === 'end'
        ? 'Last line'
        : specificStart || 'Line 1';

    // If steps already generated, go directly
    if (schematic.readingSteps.length > 0) {
      router.push({
        pathname: '/reader',
        params: { schematicId: schematic.id, direction, startLabel },
      });
      return;
    }

    setGeneratingSteps(true);
    console.log('[Analyze] Generating reading steps via OpenRouter');
    try {
      const { generateReadingSteps } = await import('@/utils/openrouter');
      const steps = await generateReadingSteps(
        {
          wires: schematic.wires,
          components: schematic.components,
          connections: schematic.connections,
          unknownSymbols: schematic.unknownSymbols,
          summary: '',
        },
        direction,
        startLabel
      );

      const updated = { ...schematic, readingSteps: steps };
      await saveSchematic(updated);
      setSchematic(updated);

      router.push({
        pathname: '/reader',
        params: { schematicId: updated.id, direction, startLabel },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'No se pudieron generar los pasos' : 'Failed to generate steps';
      console.error('[Analyze] Step generation error', e);
      setError(msg);
    } finally {
      setGeneratingSteps(false);
    }
  };

  const handleIdentifyUnknown = (symbolId: string) => {
    if (!schematic) return;
    console.log('[Analyze] Identify unknown symbol pressed', { symbolId });
    router.push({
      pathname: '/identify-symbol',
      params: { schematicId: schematic.id, symbolId, imageUri: schematic.imageUri },
    });
  };

  const toggleHighlight = (key: string) => {
    setHighlightKey((prev) => (prev === key ? null : key));
  };

  const handleAskAi = async () => {
    if (!schematic || !aiQuestion.trim() || askingAi) return;
    setAskingAi(true);
    setAiAnswer(null);
    setError(null);
    try {
      const { answerSchematicQuestion } = await import('@/utils/openrouter');
      const answer = await answerSchematicQuestion(
        {
          wires: schematic.wires,
          components: schematic.components,
          connections: schematic.connections,
          unknownSymbols: schematic.unknownSymbols,
          summary: schematic.summary ?? '',
        },
        es ? `${aiQuestion.trim()} (Responde en español.)` : aiQuestion.trim()
      );
      setAiAnswer(answer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'No se pudo obtener la respuesta de la AI' : 'Failed to get AI answer';
      console.error('[Analyze] AI question error', e);
      setError(msg);
    } finally {
      setAskingAi(false);
    }
  };

  const handleGetSuggestions = async () => {
    if (!schematic || askingAi) return;
    setAskingAi(true);
    setAiSuggestions(null);
    setError(null);
    try {
      const { answerSchematicQuestion } = await import('@/utils/openrouter');
      const suggestions = await answerSchematicQuestion(
        {
          wires: schematic.wires,
          components: schematic.components,
          connections: schematic.connections,
          unknownSymbols: schematic.unknownSymbols,
          summary: schematic.summary ?? '',
        },
        es
          ? 'Da sugerencias concisas en español sobre qué debo hacer a continuación mientras trabajo en este esquema. Incluye verificaciones, recordatorios de seguridad y un posible paso de solución de problemas.'
          : 'Give concise suggestions for what I should do next while working on this schematic. Include checks, safety reminders, and one likely troubleshooting step.'
      );
      setAiSuggestions(suggestions);
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'No se pudieron obtener sugerencias de la AI' : 'Failed to get AI suggestions';
      console.error('[Analyze] AI suggestions error', e);
      setError(msg);
    } finally {
      setAskingAi(false);
    }
  };

  const allItems = schematic
    ? [
        ...schematic.wires.map((w) => w.label),
        ...schematic.components.map((c) => c.label),
      ]
    : [];

  const filteredItems = allItems.filter((item) =>
    item.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const unknownCount = schematic?.unknownSymbols.filter((u) => !u.userIdentifiedAs).length ?? 0;
  const isHighContrast = uiPrefs.visualMode === 'highContrast';
  const isDark = uiPrefs.visualMode === 'dark';
  const isLightMode = uiPrefs.visualMode === 'normalLight';
  const activeVisionProviderLabel =
    uiPrefs.visionProvider === 'openrouter'
      ? 'OpenRouter'
      : uiPrefs.visionProvider === 'anthropic'
      ? 'Claude'
      : uiPrefs.visionProvider === 'openai'
      ? 'OpenAI'
      : uiPrefs.visionProvider === 'groq'
      ? 'Groq'
      : es
      ? 'Automático (OpenRouter → Claude → OpenAI → Groq)'
      : 'Auto (OpenRouter → Claude → OpenAI → Groq)';
  const wireDisplayLimit = uiPrefs.layoutPreset === 'residential' ? 5 : uiPrefs.layoutPreset === 'commercial' ? 10 : 8;
  const connectionDisplayLimit = uiPrefs.layoutPreset === 'residential' ? 4 : uiPrefs.layoutPreset === 'commercial' ? 8 : 6;

  // Map color name to display hex (falls back to WT.blue)
  const WIRE_COLOR_MAP: Record<string, string> = {
    red: '#FF3B30', black: '#3A3A3C', white: '#FFFFFF', blue: '#007AFF',
    yellow: '#FFD60A', green: '#34C759', orange: '#FF9500', brown: '#A2845E',
    purple: '#AF52DE', violet: '#AF52DE', gray: '#8E8E93', grey: '#8E8E93',
    pink: '#FF2D55', 'green-yellow': '#B8E000',
  };
  const wireColor = (color?: string) =>
    (color && WIRE_COLOR_MAP[color.toLowerCase()]) || WT.blue;

  // Confidence badge helper
  const ConfBadge = ({ confidence }: { confidence?: number }) => {
    if (confidence === undefined || confidence >= 0.8) return null;
    const isLow = confidence < 0.5;
    return (
      <View style={[styles.confBadge, isLow ? styles.confBadgeLow : styles.confBadgeMed]}>
        <Text style={[styles.confBadgeText, isLow && styles.confBadgeTextLow]}>{Math.round(confidence * 100)}%</Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, isLightMode && styles.rootLight, isDark && styles.rootDark, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable onPress={() => {
          console.log('[Analyze] Back button pressed');
          router.back();
        }} style={styles.backBtn} scaleValue={0.9}>
          <ArrowLeft size={22} color={WT.blue} />
        </AnimatedPressable>
        <Text style={[styles.headerTitle, isLightMode && styles.headerTitleLight, isDark && styles.headerTitleDark]}>{es ? 'Analizar Esquema' : 'Analyze Schematic'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Image */}
        {(params.imageUri || schematic?.imageUri) && (
          <View style={styles.imageContainer}>
            <Image
              source={resolveImageSource(params.imageUri || schematic?.imageUri)}
              style={styles.schematicImage}
              resizeMode="contain"
            />
          </View>
        )}

        {/* Loading state */}
        {loading && (
          <View style={styles.loadingSection}>
            <Animated.View style={[styles.loadingDot, { opacity: pulseAnim }]}>
              <Zap size={20} color={WT.blue} fill={WT.blue} />
            </Animated.View>
            <Text style={styles.loadingTitle}>{es ? 'Analizando esquema...' : 'Analyzing schematic...'}</Text>
            <Text style={styles.loadingSubtitle}>{es ? 'La AI está extrayendo cables, componentes y conexiones' : 'AI is extracting wires, components, and connections'}</Text>
            <Text style={styles.loadingProviderText}>{es ? 'Proveedor AI activo: ' : 'Active AI Provider: '}{activeVisionProviderLabel}</Text>
            <View style={{ gap: 12, marginTop: 8 }}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          </View>
        )}

        {/* Error state */}
        {error && !loading && (
          <View style={styles.errorCard}>
            <AlertTriangle size={24} color={WT.red} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>{es ? 'El análisis falló' : 'Analysis failed'}</Text>
              <Text style={styles.errorMsg}>{error}</Text>
            </View>
            <AnimatedPressable
              onPress={() => {
                console.log('[Analyze] Retry button pressed');
                if (params.imageUri) runAnalysis(params.imageUri);
              }}
              style={styles.retryBtn}
            >
              <RefreshCw size={16} color={WT.blue} />
              <Text style={styles.retryBtnText}>{es ? 'Reintentar' : 'Retry'}</Text>
            </AnimatedPressable>
          </View>
        )}

        {/* Results */}
        {schematic && !loading && (
          <>
            <View style={[styles.prefBanner, isHighContrast && styles.prefBannerHighContrast, isDark && styles.prefBannerDark]}>
              <Text style={[styles.prefBannerText, isLightMode && styles.prefBannerTextDark]}>
                {es ? 'Visual: ' : 'Visual: '}
                {es
                  ? uiPrefs.visualMode === 'normalLight' ? 'Luz Normal' : uiPrefs.visualMode === 'highContrast' ? 'Alto Contraste' : 'Oscuro'
                  : uiPrefs.visualMode === 'normalLight' ? 'Normal Light' : uiPrefs.visualMode === 'highContrast' ? 'High Contrast' : 'Dark'}
                {' • '}
                {es ? 'Diseño: ' : 'Layout: '}
                {es
                  ? uiPrefs.layoutPreset === 'industrial' ? 'Industrial' : uiPrefs.layoutPreset === 'residential' ? 'Residencial' : 'Comercial'
                  : uiPrefs.layoutPreset.charAt(0).toUpperCase() + uiPrefs.layoutPreset.slice(1)}
              </Text>
            </View>

            {/* Unknown symbols warning */}
            {unknownCount > 0 && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={18} color={WT.yellow} />
                <Text style={styles.warningText}>
                  {es
                    ? `${unknownCount} símbolo${unknownCount !== 1 ? 's' : ''} desconocido${unknownCount !== 1 ? 's' : ''} encontrado${unknownCount !== 1 ? 's' : ''} — identifícalos para mejores resultados`
                    : `${unknownCount} unknown symbol${unknownCount !== 1 ? 's' : ''} found — identify them for best results`}
                </Text>
                <AnimatedPressable
                  onPress={() => {
                    console.log('[Analyze] Identify Now pressed');
                    const first = schematic.unknownSymbols.find((u) => !u.userIdentifiedAs);
                    if (first) handleIdentifyUnknown(first.id);
                  }}
                  style={styles.identifyNowBtn}
                >
                  <Text style={styles.identifyNowText}>{es ? 'Identificar' : 'Identify'}</Text>
                </AnimatedPressable>
              </View>
            )}

            {/* AI Summary */}
            {schematic.summary ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{es ? 'Resumen AI' : 'AI Summary'}</Text>
                <Text style={styles.summaryText}>{schematic.summary}</Text>
              </View>
            ) : null}

            <View style={[styles.card, isHighContrast && styles.highContrastCard]}>
              <View style={styles.cardHeader}>
                <MessageSquare size={16} color={WT.blue} />
                <Text style={styles.cardTitle}>{es ? 'Preguntar a la AI / Obtener Indicaciones' : 'Ask AI / Get Directions'}</Text>
              </View>
              <Text style={styles.aiHelperText}>
                {es ? 'Haz una pregunta o pide orientación mientras usas este esquema.' : 'Ask a question or request guidance while using this schematic.'}
              </Text>
              <AnimatedPressable
                onPress={handleGetSuggestions}
                style={[styles.aiSuggestBtn, askingAi && styles.aiAskBtnDisabled]}
                disabled={askingAi}
              >
                <Text style={styles.aiSuggestBtnText}>{askingAi ? (es ? 'Trabajando...' : 'Working...') : es ? 'Obtener Sugerencias de la AI' : 'Get AI Suggestions'}</Text>
              </AnimatedPressable>
              {aiSuggestions ? (
                <View style={styles.aiAnswerBox}>
                  <Text style={styles.aiAnswerLabel}>{es ? 'Sugerencias' : 'Suggestions'}</Text>
                  <Text style={styles.aiAnswerText}>{aiSuggestions}</Text>
                </View>
              ) : null}
              <TextInput
                style={styles.aiInput}
                placeholder={es ? 'Ejemplo: ¿qué debo revisar primero si el cable 14 no tiene voltaje?' : 'Example: what should I check first if wire 14 has no voltage?'}
                placeholderTextColor={WT.textTertiary}
                value={aiQuestion}
                onChangeText={setAiQuestion}
                multiline
              />
              <AnimatedPressable
                onPress={handleAskAi}
                style={[styles.aiAskBtn, (!aiQuestion.trim() || askingAi) && styles.aiAskBtnDisabled]}
                disabled={!aiQuestion.trim() || askingAi}
              >
                <Send size={15} color="#FFFFFF" />
                <Text style={styles.aiAskBtnText}>{askingAi ? (es ? 'Preguntando a la AI...' : 'Asking AI...') : es ? 'Preguntar a la AI' : 'Ask AI'}</Text>
              </AnimatedPressable>
              {aiAnswer ? (
                <View style={styles.aiAnswerBox}>
                  <Text style={styles.aiAnswerLabel}>{es ? 'Respuesta' : 'Answer'}</Text>
                  <Text style={styles.aiAnswerText}>{aiAnswer}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.highlightHint}>
              <Highlighter size={15} color={WT.yellow} />
              <Text style={styles.highlightHintText}>
                {es ? 'Toca cualquier cable, componente, conexión o símbolo desconocido para resaltarlo.' : 'Tap any wire, component, connection, or unknown symbol to highlight it.'}
              </Text>
            </View>

            {/* Wire Summary */}
            <View style={[styles.card, isHighContrast && styles.highContrastCard, isDark && styles.darkCard]}>
              <View style={styles.cardHeader}>
                <Zap size={16} color={WT.blue} />
                <Text style={[styles.cardTitle, isDark && styles.darkPrimaryText]}>{es ? 'Resumen de Cables' : 'Wire Summary'}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{schematic.wireCount}</Text>
                </View>
              </View>
              {schematic.wires.length === 0 ? (
                <Text style={styles.emptyCardText}>{es ? 'No se detectaron cables' : 'No wires detected'}</Text>
              ) : (
                schematic.wires.slice(0, wireDisplayLimit).map((wire) => (
                  <AnimatedPressable
                    key={wire.id}
                    onPress={() => toggleHighlight(`wire:${wire.id}`)}
                    style={[styles.wireRow, highlightKey === `wire:${wire.id}` && styles.highlightedRow]}
                    scaleValue={0.99}
                  >
                    <View style={[styles.wireColorDot, { backgroundColor: wireColor(wire.color) }]} />
                    <Text
                      style={[
                        styles.wireLabel,
                        isDark && styles.darkPrimaryText,
                        wire.color ? { color: wireColor(wire.color) } : null,
                      ]}
                    >
                      {wire.label}
                    </Text>
                    <Text style={[styles.wireRoute, isDark && styles.darkSecondaryText]} numberOfLines={1}>
                      {wire.fromPoint}
                      {' → '}
                      {wire.toPoint}
                    </Text>
                    {wire.voltage ? (
                      <View style={styles.voltageBadge}>
                        <Text style={styles.voltageBadgeText}>{wire.voltage}</Text>
                      </View>
                    ) : null}
                    <ConfBadge confidence={wire.confidence} />
                  </AnimatedPressable>
                ))
              )}
              {schematic.wires.length > wireDisplayLimit && (
                <Text style={styles.moreText}>
                  {es
                    ? `+${schematic.wires.length - wireDisplayLimit} cables más`
                    : `+${schematic.wires.length - wireDisplayLimit} more wires`}
                </Text>
              )}
            </View>

            {/* Components */}
            <View style={[styles.card, isHighContrast && styles.highContrastCard, isDark && styles.darkCard]}>
              <View style={styles.cardHeader}>
                <Cpu size={16} color={WT.blue} />
                <Text style={[styles.cardTitle, isDark && styles.darkPrimaryText]}>{es ? 'Componentes Encontrados' : 'Components Found'}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{schematic.componentCount}</Text>
                </View>
              </View>
              {schematic.components.length === 0 ? (
                <Text style={styles.emptyCardText}>{es ? 'No se detectaron componentes' : 'No components detected'}</Text>
              ) : (
                schematic.components.map((comp) => (
                  <AnimatedPressable
                    key={comp.id}
                    onPress={() => toggleHighlight(`component:${comp.id}`)}
                    style={[styles.componentRow, highlightKey === `component:${comp.id}` && styles.highlightedRow]}
                    scaleValue={0.99}
                  >
                    <View style={styles.componentLeft}>
                      <Text style={[styles.componentLabel, isDark && styles.darkPrimaryText]}>{comp.label}</Text>
                      <View style={[styles.typeBadge, comp.isUnknown && styles.typeBadgeUnknown]}>
                        <Text style={[styles.typeBadgeText, comp.isUnknown && styles.typeBadgeTextUnknown]}>
                          {comp.userIdentifiedAs || comp.type}
                        </Text>
                      </View>
                      <ConfBadge confidence={comp.confidence} />
                    </View>
                    <Text style={[styles.componentDesc, isDark && styles.darkSecondaryText]} numberOfLines={isDark ? 4 : 2}>
                      {comp.description}
                    </Text>
                  </AnimatedPressable>
                ))
              )}
            </View>

            {/* Unknown Symbols */}
            {schematic.unknownSymbols.length > 0 && (
              <View style={[styles.card, isHighContrast && styles.highContrastCard, isDark && styles.darkCard]}>
                <View style={styles.cardHeader}>
                  <AlertTriangle size={16} color={WT.yellow} />
                  <Text style={[styles.cardTitle, isDark && styles.darkPrimaryText]}>{es ? 'Símbolos Desconocidos' : 'Unknown Symbols'}</Text>
                  <View style={[styles.countBadge, styles.countBadgeWarning]}>
                    <Text style={[styles.countBadgeText, styles.countBadgeTextWarning]}>
                      {schematic.unknownSymbols.length}
                    </Text>
                  </View>
                </View>
                {schematic.unknownSymbols.map((sym) => (
                  <AnimatedPressable
                    key={sym.id}
                    onPress={() => toggleHighlight(`unknown:${sym.id}`)}
                    style={[styles.unknownRow, highlightKey === `unknown:${sym.id}` && styles.highlightedRow]}
                    scaleValue={0.99}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.unknownDesc, isDark && styles.darkSecondaryText]}>{sym.description}</Text>
                      {sym.userIdentifiedAs && (
                        <View style={styles.identifiedBadge}>
                          <CheckCircle size={12} color={WT.green} />
                          <Text style={styles.identifiedText}>{sym.userIdentifiedAs}</Text>
                        </View>
                      )}
                    </View>
                    {!sym.userIdentifiedAs && (
                      <AnimatedPressable
                        onPress={() => handleIdentifyUnknown(sym.id)}
                        style={styles.tapIdentifyBtn}
                      >
                        <Text style={styles.tapIdentifyText}>{es ? 'Identificar' : 'Identify'}</Text>
                      </AnimatedPressable>
                    )}
                  </AnimatedPressable>
                ))}
              </View>
            )}

            {/* Connections */}
            <View style={[styles.card, isHighContrast && styles.highContrastCard, isDark && styles.darkCard]}>
              <View style={styles.cardHeader}>
                <View style={styles.connectionIcon}>
                  <Text style={styles.connectionIconText}>⟶</Text>
                </View>
                <Text style={[styles.cardTitle, isDark && styles.darkPrimaryText]}>{es ? 'Conexiones Punto a Punto' : 'Point-to-Point Connections'}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{schematic.connections.length}</Text>
                </View>
              </View>
              {schematic.connections.length === 0 ? (
                <Text style={styles.emptyCardText}>{es ? 'No se detectaron conexiones' : 'No connections detected'}</Text>
              ) : (
                schematic.connections.slice(0, connectionDisplayLimit).map((conn) => (
                  <AnimatedPressable
                    key={conn.id}
                    onPress={() => toggleHighlight(`connection:${conn.id}`)}
                    style={[styles.connectionRow, highlightKey === `connection:${conn.id}` && styles.highlightedRow]}
                    scaleValue={0.99}
                  >
                    <Text style={[styles.connectionWire, isDark && styles.darkPrimaryText]}>{conn.wireLabel}</Text>
                    <Text style={[styles.connectionDesc, isDark && styles.darkSecondaryText]} numberOfLines={2}>
                      {conn.description}
                    </Text>
                  </AnimatedPressable>
                ))
              )}
              {schematic.connections.length > connectionDisplayLimit && (
                <Text style={styles.moreText}>
                  {es
                    ? `+${schematic.connections.length - connectionDisplayLimit} conexiones más`
                    : `+${schematic.connections.length - connectionDisplayLimit} more connections`}
                </Text>
              )}
            </View>

            {/* Reading Direction */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{es ? 'Dirección de Lectura' : 'Reading Direction'}</Text>
              <View style={styles.directionToggle}>
                <AnimatedPressable
                  onPress={() => {
                    console.log('[Analyze] Direction set to forward');
                    setDirection('forward');
                  }}
                  style={[styles.dirBtn, direction === 'forward' && styles.dirBtnActive]}
                >
                  <Text style={[styles.dirBtnText, direction === 'forward' && styles.dirBtnTextActive]}>
                    {es ? 'Adelante (Línea 1 → Final)' : 'Forward (Line 1 → End)'}
                  </Text>
                </AnimatedPressable>
                <AnimatedPressable
                  onPress={() => {
                    console.log('[Analyze] Direction set to backward');
                    setDirection('backward');
                  }}
                  style={[styles.dirBtn, direction === 'backward' && styles.dirBtnActive]}
                >
                  <Text style={[styles.dirBtnText, direction === 'backward' && styles.dirBtnTextActive]}>
                    {es ? 'Atrás (Final → Línea 1)' : 'Backward (End → Line 1)'}
                  </Text>
                </AnimatedPressable>
              </View>

              <Text style={styles.startLabel}>{es ? 'Punto de Inicio' : 'Start Point'}</Text>
              <View style={styles.startOptions}>
                {(['beginning', 'end', 'specific'] as StartPoint[]).map((opt) => {
                  const labels: Record<StartPoint, string> = es
                    ? {
                        beginning: 'Desde el Principio',
                        end: 'Desde el Final',
                        specific: 'Cable/Componente Específico',
                      }
                    : {
                        beginning: 'From Beginning',
                        end: 'From End',
                        specific: 'Specific Wire/Component',
                      };
                  return (
                    <AnimatedPressable
                      key={opt}
                      onPress={() => {
                        console.log('[Analyze] Start point selected', { opt });
                        setStartPoint(opt);
                        if (opt === 'specific') setShowStartPicker(true);
                      }}
                      style={[styles.startOpt, startPoint === opt && styles.startOptActive]}
                    >
                      <View style={[styles.startOptRadio, startPoint === opt && styles.startOptRadioActive]} />
                      <Text style={[styles.startOptText, startPoint === opt && styles.startOptTextActive]}>
                        {labels[opt]}
                      </Text>
                    </AnimatedPressable>
                  );
                })}
              </View>

              {startPoint === 'specific' && (
                <View style={styles.specificPicker}>
                  <AnimatedPressable
                    onPress={() => {
                      console.log('[Analyze] Toggle start picker', { showStartPicker });
                      setShowStartPicker(!showStartPicker);
                    }}
                    style={styles.pickerToggle}
                  >
                    <Search size={16} color={WT.textSecondary} />
                    <Text style={[styles.pickerToggleText, specificStart && { color: WT.textPrimary }]}>
                      {specificStart || (es ? 'Buscar cables y componentes...' : 'Search wires & components...')}
                    </Text>
                    {showStartPicker ? (
                      <ChevronUp size={16} color={WT.textSecondary} />
                    ) : (
                      <ChevronDown size={16} color={WT.textSecondary} />
                    )}
                  </AnimatedPressable>

                  {showStartPicker && (
                    <View style={styles.pickerDropdown}>
                      <TextInput
                        style={styles.pickerSearch}
                        placeholder={es ? 'Buscar...' : 'Search...'}
                        placeholderTextColor={WT.textTertiary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        autoFocus
                      />
                      {filteredItems.map((item) => (
                        <AnimatedPressable
                          key={item}
                          onPress={() => {
                            console.log('[Analyze] Specific start selected', { item });
                            setSpecificStart(item);
                            setShowStartPicker(false);
                            setSearchQuery('');
                          }}
                          style={styles.pickerItem}
                        >
                          <Text style={styles.pickerItemText}>{item}</Text>
                        </AnimatedPressable>
                      ))}
                      {filteredItems.length === 0 && (
                        <Text style={styles.pickerEmpty}>{es ? 'No se encontraron coincidencias' : 'No matches found'}</Text>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Start Reading button */}
      {schematic && !loading && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          <AnimatedPressable
            onPress={handleStartReading}
            style={styles.startBtn}
            disabled={generatingSteps}
            scaleValue={0.97}
          >
            {generatingSteps ? (
              <Text style={styles.startBtnText}>{es ? 'Generando pasos...' : 'Generating steps...'}</Text>
            ) : (
              <>
                <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
                <Text style={styles.startBtnText}>{es ? 'Comenzar Lectura' : 'Start Reading'}</Text>
              </>
            )}
          </AnimatedPressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  rootLight: {
    backgroundColor: '#F4F7FB',
  },
  rootDark: {
    backgroundColor: '#061A22',
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
  headerTitleLight: {
    color: '#0F172A',
  },
  headerTitleDark: {
    color: '#D6F8FF',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  imageContainer: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
    height: 200,
  },
  schematicImage: {
    width: '100%',
    height: '100%',
  },
  loadingSection: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  loadingDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: WT.blueMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: WT.textSecondary,
    textAlign: 'center',
  },
  loadingProviderText: {
    fontSize: 12,
    color: WT.blue,
    fontWeight: '600',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WT.redMuted,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.2)',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: WT.red,
  },
  errorMsg: {
    fontSize: 13,
    color: WT.textSecondary,
    marginTop: 2,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: WT.bgCard,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.blue,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WT.yellowMuted,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.2)',
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: WT.yellow,
    lineHeight: 18,
  },
  prefBanner: {
    backgroundColor: WT.bgCardAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: WT.border,
  },
  prefBannerHighContrast: {
    borderColor: WT.yellow,
    backgroundColor: 'rgba(255,214,10,0.16)',
  },
  prefBannerDark: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.16)',
  },
  prefBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: WT.textSecondary,
    textAlign: 'center',
  },
  prefBannerTextDark: {
    color: WT.textPrimary,
  },
  identifyNowBtn: {
    backgroundColor: WT.yellow,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  identifyNowText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  card: {
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 10,
  },
  highContrastCard: {
    borderWidth: 2,
    borderColor: WT.yellow,
  },
  darkCard: {
    borderColor: 'rgba(0,229,255,0.3)',
    backgroundColor: '#0D2530',
  },
  aiHelperText: {
    fontSize: 12,
    color: WT.textSecondary,
    lineHeight: 18,
  },
  aiInput: {
    minHeight: 70,
    backgroundColor: WT.bgInput,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: WT.textPrimary,
    textAlignVertical: 'top',
  },
  aiSuggestBtn: {
    backgroundColor: WT.bgCardAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.border,
    paddingVertical: 9,
    alignItems: 'center',
  },
  aiSuggestBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  aiAskBtn: {
    backgroundColor: WT.blue,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  aiAskBtnDisabled: {
    opacity: 0.6,
  },
  aiAskBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  aiAnswerBox: {
    backgroundColor: WT.bgCardAlt,
    borderWidth: 1,
    borderColor: WT.border,
    borderRadius: 10,
    padding: 12,
  },
  aiAnswerText: {
    fontSize: 13,
    color: WT.textPrimary,
    lineHeight: 19,
  },
  aiAnswerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  highlightHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: WT.yellowMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  highlightHintText: {
    flex: 1,
    fontSize: 12,
    color: WT.yellow,
  },
  highlightedRow: {
    backgroundColor: WT.blueMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.blue,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: WT.textPrimary,
    flex: 1,
  },
  darkPrimaryText: {
    color: '#D6F8FF',
  },
  darkSecondaryText: {
    color: '#9AEFFF',
  },
  countBadge: {
    backgroundColor: WT.blueMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: WT.blue,
  },
  countBadgeWarning: {
    backgroundColor: WT.yellowMuted,
  },
  countBadgeTextWarning: {
    color: WT.yellow,
  },
  emptyCardText: {
    fontSize: 13,
    color: WT.textTertiary,
    fontStyle: 'italic',
  },
  wireRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: WT.border,
  },
  wireColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wireLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.blue,
    minWidth: 60,
  },
  wireRoute: {
    flex: 1,
    fontSize: 12,
    color: WT.textSecondary,
  },
  moreText: {
    fontSize: 12,
    color: WT.textTertiary,
    textAlign: 'center',
    paddingTop: 4,
  },
  componentRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: WT.border,
    gap: 4,
  },
  componentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  componentLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  typeBadge: {
    backgroundColor: WT.blueMuted,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typeBadgeUnknown: {
    backgroundColor: WT.yellowMuted,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: WT.blue,
    textTransform: 'capitalize',
  },
  typeBadgeTextUnknown: {
    color: WT.yellow,
  },
  componentDesc: {
    fontSize: 12,
    color: WT.textSecondary,
    lineHeight: 17,
  },
  unknownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: WT.border,
    gap: 10,
  },
  unknownDesc: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 18,
  },
  identifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  identifiedText: {
    fontSize: 12,
    color: WT.green,
    fontWeight: '600',
  },
  tapIdentifyBtn: {
    backgroundColor: WT.yellowMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.2)',
  },
  tapIdentifyText: {
    fontSize: 12,
    fontWeight: '600',
    color: WT.yellow,
  },
  connectionIcon: {
    width: 20,
    alignItems: 'center',
  },
  connectionIconText: {
    fontSize: 14,
    color: WT.blue,
  },
  connectionRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: WT.border,
    gap: 3,
  },
  connectionWire: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.blue,
  },
  connectionDesc: {
    fontSize: 12,
    color: WT.textSecondary,
    lineHeight: 17,
  },
  directionToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  dirBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: WT.bgCardAlt,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: WT.border,
  },
  dirBtnActive: {
    backgroundColor: WT.blueMuted,
    borderColor: WT.blue,
  },
  dirBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: WT.textSecondary,
    textAlign: 'center',
  },
  dirBtnTextActive: {
    color: WT.blue,
    fontWeight: '600',
  },
  startLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textSecondary,
    marginTop: 4,
  },
  startOptions: {
    gap: 8,
  },
  startOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: WT.bgCardAlt,
    borderWidth: 1,
    borderColor: WT.border,
  },
  startOptActive: {
    backgroundColor: WT.blueMuted,
    borderColor: WT.blue,
  },
  startOptRadio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: WT.textTertiary,
  },
  startOptRadioActive: {
    borderColor: WT.blue,
    backgroundColor: WT.blue,
  },
  startOptText: {
    fontSize: 14,
    color: WT.textSecondary,
  },
  startOptTextActive: {
    color: WT.blue,
    fontWeight: '600',
  },
  specificPicker: {
    gap: 4,
  },
  pickerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: WT.bgInput,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: WT.border,
  },
  pickerToggleText: {
    flex: 1,
    fontSize: 14,
    color: WT.textTertiary,
  },
  pickerDropdown: {
    backgroundColor: WT.bgCardAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.border,
    overflow: 'hidden',
    maxHeight: 200,
  },
  pickerSearch: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: WT.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  pickerItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  pickerItemText: {
    fontSize: 14,
    color: WT.textPrimary,
  },
  pickerEmpty: {
    padding: 12,
    fontSize: 13,
    color: WT.textTertiary,
    textAlign: 'center',
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: WT.border,
    backgroundColor: WT.bg,
  },
  startBtn: {
    backgroundColor: WT.blue,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  startBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryCard: {
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: WT.border,
    borderLeftWidth: 3,
    borderLeftColor: WT.blue,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryText: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 19,
  },
  voltageBadge: {
    backgroundColor: WT.bgCardAlt,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: WT.border,
  },
  voltageBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: WT.textSecondary,
  },
  confBadge: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  confBadgeMed: {
    backgroundColor: WT.yellowMuted,
  },
  confBadgeLow: {
    backgroundColor: WT.redMuted,
  },
  confBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: WT.yellow,
  },
  confBadgeTextLow: {
    color: WT.red,
  },
});
