import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { prepareImageForAI } from '@/utils/image-resize';
import { speakText } from '@/utils/tts';
import PulsingLogo from '@/components/PulsingLogo';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  GitBranch,
  Highlighter,
  MessageSquare,
  Mic,
  StickyNote,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
  Zap,
} from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import { analyzeSchematic, analyzeMultipleImages, AnalysisResult, generateCustomOrderReadingSteps, generateReadingSteps, parseVoiceCorrection } from '@/utils/openrouter';
import { analyzeSchematicMultiPass, MultiPassCoverage } from '@/utils/multi-pass-analysis';
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
import { findJunctions, matchJunctionAnswer } from '@/utils/schematic-graph';
import { DEFAULT_UI_PREFERENCES, loadUIPreferences } from '@/utils/ui-preferences';

function targetMatches(target: { kind: string; id?: string } | null, kind: string, id: string): boolean {
  return !!target && target.kind === kind && target.id === id;
}

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: '' };
  if (typeof source === 'string') return { uri: source };
  return source as ImageSourcePropType;
}

function AnimatedPressable({
  onPress,
  onLongPress,
  onPressOut: onPressOutProp,
  style,
  children,
  scaleValue = 0.97,
  disabled,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
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
      <Pressable
        onPressIn={animIn}
        onPressOut={() => {
          animOut();
          onPressOutProp?.();
        }}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={450}
        disabled={disabled}
        style={style}
      >
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

// Analysis is one long vision call with no byte-level progress to report, so
// the bar is driven off the stages we *can* observe (image prep, request sent,
// save) and creeps toward 90% while the model is thinking. It only reaches
// 100% when the analysis actually lands.
function AnalysisProgressBar({ progress }: { progress: Animated.Value }) {
  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  // Blue glow behind the pink fill, breathing in time with the header bolt.
  // Kept on its own node so the native-driven opacity never collides with the
  // JS-driven width on the fill itself.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.6] });

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressGlow, { opacity: glowOpacity }]} />
      <Animated.View style={[styles.progressFill, { width }]}>
        <View style={styles.progressTip} />
      </Animated.View>
    </View>
  );
}

type ReadingDirection = 'forward' | 'backward';
type StartPoint = 'beginning' | 'end' | 'specific' | 'custom';

type EditTarget =
  | { kind: 'wire'; id: string }
  | { kind: 'newWire' }
  | { kind: 'component'; id: string }
  | { kind: 'newComponent' }
  | { kind: 'connection'; id: string }
  | { kind: 'summary' };

interface EditFieldDef {
  key: string;
  label: string;
  labelEs: string;
  multiline?: boolean;
}

const EDIT_FIELDS: Record<EditTarget['kind'], EditFieldDef[]> = {
  wire: [
    { key: 'label', label: 'Wire Label', labelEs: 'Etiqueta del Cable' },
    { key: 'color', label: 'Color', labelEs: 'Color' },
    { key: 'fromPoint', label: 'From', labelEs: 'Desde' },
    { key: 'toPoint', label: 'To', labelEs: 'Hasta' },
    { key: 'voltage', label: 'Voltage', labelEs: 'Voltaje' },
  ],
  newWire: [
    { key: 'label', label: 'Wire Label', labelEs: 'Etiqueta del Cable' },
    { key: 'color', label: 'Color', labelEs: 'Color' },
    { key: 'fromPoint', label: 'From', labelEs: 'Desde' },
    { key: 'toPoint', label: 'To', labelEs: 'Hasta' },
    { key: 'voltage', label: 'Voltage', labelEs: 'Voltaje' },
  ],
  component: [
    { key: 'label', label: 'Component Label', labelEs: 'Etiqueta del Componente' },
    { key: 'type', label: 'Type', labelEs: 'Tipo' },
    { key: 'description', label: 'Description', labelEs: 'Descripción', multiline: true },
  ],
  newComponent: [
    { key: 'label', label: 'Component Label', labelEs: 'Etiqueta del Componente' },
    { key: 'type', label: 'Type', labelEs: 'Tipo' },
    { key: 'description', label: 'Description', labelEs: 'Descripción', multiline: true },
  ],
  connection: [
    { key: 'wireLabel', label: 'Wire Label', labelEs: 'Etiqueta del Cable' },
    { key: 'from', label: 'From', labelEs: 'Desde' },
    { key: 'to', label: 'To', labelEs: 'Hasta' },
    { key: 'description', label: 'Description', labelEs: 'Descripción', multiline: true },
  ],
  summary: [{ key: 'summary', label: 'AI Summary', labelEs: 'Resumen AI', multiline: true }],
};

const EDIT_TITLES: Record<EditTarget['kind'], { en: string; es: string }> = {
  wire: { en: 'Edit Wire', es: 'Editar Cable' },
  newWire: { en: 'Add Wire', es: 'Agregar Cable' },
  component: { en: 'Edit Component', es: 'Editar Componente' },
  newComponent: { en: 'Add Component', es: 'Agregar Componente' },
  connection: { en: 'Edit Connection', es: 'Editar Conexión' },
  summary: { en: 'Edit AI Summary', es: 'Editar Resumen AI' },
};

export default function AnalyzeScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Fill most of the first screenful with the drawing while leaving the results
  // below it obviously scrollable — a picture that exactly fills the viewport
  // reads as the whole page and nobody scrolls.
  const schematicImageHeight = Math.round(windowHeight * 0.62);
  const params = useLocalSearchParams<{ imageUri?: string; imageUris?: string; schematicId?: string }>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schematic, setSchematic] = useState<SchematicAnalysis | null>(null);
  const schematicIdRef = useRef<string | null>(null);
  useEffect(() => {
    schematicIdRef.current = schematic?.id ?? null;
  }, [schematic?.id]);

  const [direction, setDirection] = useState<ReadingDirection>('forward');
  const [startPoint, setStartPoint] = useState<StartPoint>('beginning');
  const [startPointTouched, setStartPointTouched] = useState(false);
  const [specificStart, setSpecificStart] = useState('');
  const [branchChoices, setBranchChoices] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [generatingSteps, setGeneratingSteps] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string | null>(null);
  const [askingAi, setAskingAi] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [uiPrefs, setUiPrefs] = useState(DEFAULT_UI_PREFERENCES);
  // Preferences arrive after the screen mounts, and the scan kicks off from an
  // effect keyed on runAnalysis. Reading them through a ref keeps that callback
  // stable, so a preference landing mid-scan can't retrigger the analysis.
  const uiPrefsRef = useRef(uiPrefs);
  useEffect(() => {
    uiPrefsRef.current = uiPrefs;
  }, [uiPrefs]);
  const [language, setLanguage] = useState<AppLanguage>('english');
  const es = isSpanish(language);

  // Voice correction — long-press-and-hold a row, speak the fix, release to submit
  const [correctionListening, setCorrectionListening] = useState(false);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionStatus, setCorrectionStatus] = useState<string | null>(null);
  const correctionTargetRef = useRef<EditTarget | null>(null);
  const correctionActiveRef = useRef(false);
  const correctionTranscriptRef = useRef('');

  // Voice notes — separate mic button, hold to record, read aloud in the Reader
  const [noteListening, setNoteListening] = useState(false);
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const noteTargetRef = useRef<EditTarget | null>(null);
  const noteActiveRef = useRef(false);
  const noteTranscriptRef = useRef('');

  // Suggest saving as a verified "standard" once the user has actually fixed something
  const [correctionsMade, setCorrectionsMade] = useState(0);
  const [standardPromptDismissed, setStandardPromptDismissed] = useState(false);
  const [savingStandard, setSavingStandard] = useState(false);
  const [connectionsExpanded, setConnectionsExpanded] = useState(false);
  const [wiresExpanded, setWiresExpanded] = useState(false);

  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  // Progress bars — one for the analysis run, one for step generation
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const stepsProgressAnim = useRef(new Animated.Value(0)).current;
  const stepsProgressAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const driveProgress = useCallback(
    (
      value: Animated.Value,
      holder: React.MutableRefObject<Animated.CompositeAnimation | null>,
      toValue: number,
      duration: number
    ) => {
      holder.current?.stop();
      const anim = Animated.timing(value, {
        toValue,
        duration,
        // width is a layout prop — it can't run on the native driver
        useNativeDriver: false,
      });
      holder.current = anim;
      anim.start();
    },
    []
  );

  const animateProgressTo = useCallback(
    (toValue: number, duration: number) => driveProgress(progressAnim, progressAnimRef, toValue, duration),
    [driveProgress, progressAnim]
  );

  const animateStepsProgressTo = useCallback(
    (toValue: number, duration: number) =>
      driveProgress(stepsProgressAnim, stepsProgressAnimRef, toValue, duration),
    [driveProgress, stepsProgressAnim]
  );

  const resetStepsProgress = useCallback(() => {
    stepsProgressAnimRef.current?.stop();
    stepsProgressAnimRef.current = null;
    stepsProgressAnim.setValue(0);
  }, [stepsProgressAnim]);

  const resetProgress = useCallback(() => {
    progressAnimRef.current?.stop();
    progressAnimRef.current = null;
    progressAnim.setValue(0);
  }, [progressAnim]);

  useEffect(() => {
    return () => {
      progressAnimRef.current?.stop();
      stepsProgressAnimRef.current?.stop();
    };
  }, []);

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
      // Pick up changes saved by sub-screens (e.g. the custom reading
      // order picker) that mutate this schematic directly in storage.
      const id = schematicIdRef.current;
      if (id) {
        getSchematic(id)
          .then((s) => {
            if (isMounted && s) setSchematic(s);
          })
          .catch((error) => {
            console.error('[Analyze] Failed to refresh schematic on focus', error);
          });
      }
      return () => {
        isMounted = false;
      };
    }, [])
  );

  const runAnalysis = useCallback(async (imageUri: string) => {
    setLoading(true);
    setError(null);
    resetProgress();
    setProgressStage(es ? 'Preparando la imagen...' : 'Preparing image...');
    animateProgressTo(0.12, 500);
    console.log('[Analyze] Starting schematic analysis', { imageUri });

    try {
      console.log('[Analyze] Preparing image for upload');
      const base64 = await prepareImageForAI(imageUri);

      const highDetail = uiPrefsRef.current.multiPassAnalysis;
      setProgressStage(
        highDetail
          ? es
            ? 'Leyendo el esquema en alto detalle...'
            : 'Reading the schematic in high detail...'
          : es
          ? 'Leyendo el esquema con la AI...'
          : 'Reading the schematic with AI...'
      );
      // Real checkpoint, then a slow creep to 90% while the model works. High
      // detail is three calls back to back, so the creep is stretched to match
      // rather than parking the bar at 90% for most of the wait.
      animateProgressTo(0.35, 400);
      setTimeout(() => animateProgressTo(0.9, highDetail ? 75000 : 30000), 400);

      console.log('[Analyze] Calling schematic analysis', { highDetail });
      let result: AnalysisResult;
      let scanCoverage: MultiPassCoverage | undefined;
      if (highDetail) {
        const multiPass = await analyzeSchematicMultiPass(base64);
        scanCoverage = multiPass.coverage;
        result = multiPass;
      } else {
        result = await analyzeSchematic(base64);
      }

      setProgressStage(es ? 'Guardando resultados...' : 'Saving results...');
      animateProgressTo(0.95, 300);

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
        validationWarnings: result.validationWarnings,
        scanCoverage,
      };

      await saveSchematic(newSchematic);
      setSchematic(newSchematic);
      animateProgressTo(1, 250);
      console.log('[Analyze] Analysis complete', { id: newSchematic.id, wires: newSchematic.wireCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'El análisis falló' : 'Analysis failed';
      console.error('[Analyze] Analysis error', e);
      setError(msg);
      resetProgress();
    } finally {
      setLoading(false);
      setProgressStage(null);
    }
  }, [es, animateProgressTo, resetProgress]);

  const runMultiAnalysis = useCallback(async (imageUris: string[]) => {
    setLoading(true);
    setError(null);
    resetProgress();
    setProgressStage(
      es ? `Preparando ${imageUris.length} páginas...` : `Preparing ${imageUris.length} pages...`
    );
    animateProgressTo(0.05, 400);
    console.log('[Analyze] Starting multi-page analysis', { pageCount: imageUris.length });

    try {
      console.log('[Analyze] Preparing images for upload');
      // Each page that finishes resizing is real progress worth showing
      let prepared = 0;
      const base64Images = await Promise.all(
        imageUris.map(async (uri) => {
          const b64 = await prepareImageForAI(uri);
          prepared += 1;
          animateProgressTo(0.05 + (0.3 * prepared) / imageUris.length, 300);
          return b64;
        })
      );

      setProgressStage(es ? 'Leyendo las páginas con la AI...' : 'Reading the pages with AI...');
      setTimeout(() => animateProgressTo(0.9, 40000), 300);

      console.log('[Analyze] Calling OpenRouter analyzeMultipleImages');
      const result: AnalysisResult = await analyzeMultipleImages(base64Images);

      setProgressStage(es ? 'Guardando resultados...' : 'Saving results...');
      animateProgressTo(0.95, 300);

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
        validationWarnings: result.validationWarnings,
      };

      await saveSchematic(newSchematic);
      setSchematic(newSchematic);
      animateProgressTo(1, 250);
      console.log('[Analyze] Multi-page analysis complete', { id: newSchematic.id, wires: newSchematic.wireCount });
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'El análisis falló' : 'Analysis failed';
      console.error('[Analyze] Multi-page analysis error', e);
      setError(msg);
      resetProgress();
    } finally {
      setLoading(false);
      setProgressStage(null);
    }
  }, [es, animateProgressTo, resetProgress]);

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
    console.log('[Analyze] Start Reading pressed', { direction, startPoint, specificStart, branchChoices });

    if (startPoint === 'specific' && !specificStart.trim()) {
      setError(
        es
          ? 'Elige un cable o componente específico antes de comenzar.'
          : 'Pick a specific wire or component before starting.'
      );
      return;
    }

    if (startPoint === 'custom') {
      const orderIds = schematic.customWireOrder ?? [];
      if (orderIds.length === 0) {
        setError(
          es
            ? 'Elige y ordena al menos un cable en la pantalla de orden personalizado.'
            : 'Pick and order at least one wire in the custom order screen.'
        );
        return;
      }
      const orderedLabels = orderIds
        .map((id) => schematic.wires.find((w) => w.id === id)?.label)
        .filter((label): label is string => !!label);
      const signature = `custom:${orderIds.join(',')}`;

      if (schematic.readingSteps.length > 0 && schematic.readingStepsStartLabel === signature) {
        router.push({
          pathname: '/reader',
          params: { schematicId: schematic.id, direction: 'forward', startLabel: orderedLabels[0] },
        });
        return;
      }

      setGeneratingSteps(true);
      resetStepsProgress();
      animateStepsProgressTo(0.15, 400);
      setTimeout(() => animateStepsProgressTo(0.9, 20000), 400);
      console.log('[Analyze] Generating custom-order reading steps', { count: orderedLabels.length });
      try {
        const steps = await generateCustomOrderReadingSteps(
          {
            wires: schematic.wires,
            components: schematic.components,
            connections: schematic.connections,
            unknownSymbols: schematic.unknownSymbols,
            summary: '',
          },
          orderedLabels
        );
        const updated: SchematicAnalysis = {
          ...schematic,
          readingSteps: steps,
          pendingJunction: null,
          readingStepsStartLabel: signature,
        };
        await saveSchematic(updated);
        setSchematic(updated);
        animateStepsProgressTo(1, 250);
        router.push({
          pathname: '/reader',
          params: { schematicId: updated.id, direction: 'forward', startLabel: orderedLabels[0] },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : es ? 'No se pudieron generar los pasos' : 'Failed to generate steps';
        console.error('[Analyze] Custom-order step generation error', e);
        setError(msg);
        resetStepsProgress();
      } finally {
        setGeneratingSteps(false);
      }
      return;
    }

    const startLabel =
      startPoint === 'beginning'
        ? 'Line 1'
        : startPoint === 'end'
        ? 'Last line'
        : specificStart;

    // If steps were already generated for this exact start point, go
    // directly — but a changed start point (e.g. picking a different
    // specific wire) must always regenerate, or the reader would silently
    // keep walking the old path instead of the newly chosen one.
    if (schematic.readingSteps.length > 0 && schematic.readingStepsStartLabel === startLabel) {
      router.push({
        pathname: '/reader',
        params: { schematicId: schematic.id, direction, startLabel },
      });
      return;
    }

    // No clear starting point and the user hasn't picked one — let the
    // Reader ask by voice instead of silently guessing "Line 1".
    if (schematic.startPointAmbiguous && !startPointTouched) {
      console.log('[Analyze] Start point ambiguous and unresolved — deferring to voice prompt in Reader');
      router.push({
        pathname: '/reader',
        params: { schematicId: schematic.id, direction, startLabel, needsStartPrompt: '1' },
      });
      return;
    }

    setGeneratingSteps(true);
    resetStepsProgress();
    animateStepsProgressTo(0.15, 400);
    setTimeout(() => animateStepsProgressTo(0.9, 20000), 400);
    console.log('[Analyze] Generating reading steps via OpenRouter');
    try {
      const { steps, pendingChoice } = await generateReadingSteps(
        {
          wires: schematic.wires,
          components: schematic.components,
          connections: schematic.connections,
          unknownSymbols: schematic.unknownSymbols,
          summary: '',
        },
        direction,
        startLabel,
        branchChoices
      );

      const updated = {
        ...schematic,
        readingSteps: steps,
        pendingJunction: pendingChoice,
        branchChoices,
        readingStepsStartLabel: startLabel,
      };
      await saveSchematic(updated);
      setSchematic(updated);
      animateStepsProgressTo(1, 250);

      router.push({
        pathname: '/reader',
        params: { schematicId: updated.id, direction, startLabel },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : es ? 'No se pudieron generar los pasos' : 'Failed to generate steps';
      console.error('[Analyze] Step generation error', e);
      setError(msg);
      resetStepsProgress();
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

  const openEditWire = (wire: WireInfo) => {
    setEditTarget({ kind: 'wire', id: wire.id });
    setEditValues({
      label: wire.label || '',
      color: wire.color || '',
      fromPoint: wire.fromPoint || '',
      toPoint: wire.toPoint || '',
      voltage: wire.voltage || '',
    });
  };

  const openAddWire = () => {
    setEditTarget({ kind: 'newWire' });
    setEditValues({ label: '', color: '', fromPoint: '', toPoint: '', voltage: '' });
  };

  const openEditComponent = (comp: ComponentInfo) => {
    setEditTarget({ kind: 'component', id: comp.id });
    setEditValues({
      label: comp.label || '',
      type: comp.type || '',
      description: comp.description || '',
    });
  };

  const openAddComponent = () => {
    setEditTarget({ kind: 'newComponent' });
    setEditValues({ label: '', type: '', description: '' });
  };

  const openEditConnection = (conn: Connection) => {
    setEditTarget({ kind: 'connection', id: conn.id });
    setEditValues({
      wireLabel: conn.wireLabel || '',
      from: conn.from || '',
      to: conn.to || '',
      description: conn.description || '',
    });
  };

  const openEditSummary = () => {
    if (!schematic) return;
    setEditTarget({ kind: 'summary' });
    setEditValues({ summary: schematic.summary || '' });
  };

  const closeEdit = () => {
    setEditTarget(null);
    setEditValues({});
  };

  function getCorrectionFieldValues(target: EditTarget): Record<string, string> | null {
    if (!schematic) return null;
    if (target.kind === 'wire') {
      const wire = schematic.wires.find((w) => w.id === target.id);
      if (!wire) return null;
      return {
        label: wire.label || '',
        color: wire.color || '',
        fromPoint: wire.fromPoint || '',
        toPoint: wire.toPoint || '',
        voltage: wire.voltage || '',
      };
    }
    if (target.kind === 'component') {
      const comp = schematic.components.find((c) => c.id === target.id);
      if (!comp) return null;
      return { label: comp.label || '', type: comp.type || '', description: comp.description || '' };
    }
    if (target.kind === 'connection') {
      const conn = schematic.connections.find((c) => c.id === target.id);
      if (!conn) return null;
      return {
        wireLabel: conn.wireLabel || '',
        from: conn.from || '',
        to: conn.to || '',
        description: conn.description || '',
      };
    }
    return null;
  }

  async function applyCorrectionField(target: EditTarget, field: string, newValue: string) {
    if (!schematic) return;
    let updated: SchematicAnalysis = schematic;

    if (target.kind === 'wire') {
      const wires = schematic.wires.map((w) => (w.id === target.id ? { ...w, [field]: newValue || undefined } : w));
      updated = { ...schematic, wires, readingSteps: [] };
    } else if (target.kind === 'component') {
      const components = schematic.components.map((c) => (c.id === target.id ? { ...c, [field]: newValue } : c));
      updated = { ...schematic, components, readingSteps: [] };
    } else if (target.kind === 'connection') {
      const connections = schematic.connections.map((c) => (c.id === target.id ? { ...c, [field]: newValue } : c));
      updated = { ...schematic, connections, readingSteps: [] };
    }

    setSchematic(updated);
    await saveSchematic(updated);
  }

  const startVoiceCorrection = async (target: EditTarget) => {
    if (target.kind === 'summary' || correctionListening) return;
    console.log('[Analyze] Starting voice correction', target);
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setCorrectionStatus(es ? 'Reconocimiento de voz no disponible' : 'Voice recognition unavailable');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setCorrectionStatus(es ? 'Se requiere permiso de micrófono' : 'Microphone permission required');
        return;
      }
      correctionTargetRef.current = target;
      correctionActiveRef.current = true;
      correctionTranscriptRef.current = '';
      setCorrectionStatus(es ? 'Escuchando la corrección...' : 'Listening for correction...');
      setCorrectionListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: es ? 'es-US' : 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
      });
    } catch (e) {
      console.error('[Analyze] Failed to start voice correction', e);
      setCorrectionStatus(es ? 'No se pudo iniciar el micrófono' : 'Could not start microphone');
    }
  };

  const stopVoiceCorrection = () => {
    if (!correctionActiveRef.current) return;
    correctionActiveRef.current = false;
    setCorrectionListening(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      console.error('[Analyze] Failed to stop voice correction', e);
    }
  };

  const processVoiceCorrectionResult = async () => {
    const target = correctionTargetRef.current;
    const transcript = correctionTranscriptRef.current.trim();
    correctionTargetRef.current = null;

    if (!target || !transcript) {
      setCorrectionStatus(null);
      return;
    }

    const currentFields = getCorrectionFieldValues(target);
    if (!currentFields) {
      setCorrectionStatus(null);
      return;
    }

    setCorrectionBusy(true);
    setCorrectionStatus(es ? 'Aplicando corrección...' : 'Applying correction...');
    try {
      const result = await parseVoiceCorrection(
        target.kind as 'wire' | 'component' | 'connection',
        currentFields,
        transcript
      );
      if (!result.understood) {
        const msg = es ? 'No se entendió la corrección — intenta de nuevo' : "Didn't catch that — try again";
        setCorrectionStatus(msg);
        speakText(es ? 'No entendí esa corrección.' : "I didn't catch that correction.");
        return;
      }
      await applyCorrectionField(target, result.field, result.newValue);
      setCorrectionsMade((n) => n + 1);
      const confirmMsg = es
        ? `Listo — ${result.field} cambiado a ${result.newValue}`
        : `Got it — ${result.field} changed to ${result.newValue}`;
      setCorrectionStatus(confirmMsg);
      speakText(confirmMsg);
      console.log('[Analyze] Voice correction applied', { target, field: result.field, newValue: result.newValue });
    } catch (e) {
      console.error('[Analyze] Voice correction failed', e);
      setCorrectionStatus(e instanceof Error ? e.message : es ? 'La corrección falló' : 'Correction failed');
    } finally {
      setCorrectionBusy(false);
      setTimeout(() => setCorrectionStatus(null), 3000);
    }
  };

  const startNoteRecording = async (target: EditTarget) => {
    if (target.kind !== 'wire' && target.kind !== 'component') return;
    if (noteListening || correctionListening) return;
    console.log('[Analyze] Starting note recording', target);
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setNoteStatus(es ? 'Reconocimiento de voz no disponible' : 'Voice recognition unavailable');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setNoteStatus(es ? 'Se requiere permiso de micrófono' : 'Microphone permission required');
        return;
      }
      noteTargetRef.current = target;
      noteActiveRef.current = true;
      noteTranscriptRef.current = '';
      setNoteStatus(es ? 'Grabando nota...' : 'Recording note...');
      setNoteListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: es ? 'es-US' : 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
      });
    } catch (e) {
      console.error('[Analyze] Failed to start note recording', e);
      setNoteStatus(es ? 'No se pudo iniciar el micrófono' : 'Could not start microphone');
    }
  };

  const stopNoteRecording = () => {
    if (!noteActiveRef.current) return;
    noteActiveRef.current = false;
    setNoteListening(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      console.error('[Analyze] Failed to stop note recording', e);
    }
  };

  const processNoteResult = async () => {
    const target = noteTargetRef.current;
    const transcript = noteTranscriptRef.current.trim();
    noteTargetRef.current = null;

    if (!target || !transcript || !schematic) {
      setNoteStatus(null);
      return;
    }

    let updated: SchematicAnalysis = schematic;
    let candidatePoints: string[] = [];
    if (target.kind === 'wire') {
      const wire = schematic.wires.find((w) => w.id === target.id);
      const wires = schematic.wires.map((w) => (w.id === target.id ? { ...w, userNote: transcript } : w));
      updated = { ...schematic, wires };
      if (wire) candidatePoints = [wire.fromPoint, wire.toPoint];
    } else if (target.kind === 'component') {
      const comp = schematic.components.find((c) => c.id === target.id);
      const components = schematic.components.map((c) => (c.id === target.id ? { ...c, userNote: transcript } : c));
      updated = { ...schematic, components };
      if (comp) candidatePoints = [comp.label];
    }

    // If this note was recorded at a junction (a terminal where the path
    // splits), and it clearly names one of the branch options, resolve the
    // ambiguity outright instead of just leaving it as narration.
    const junctions = findJunctions(schematic.connections);
    let resolvedTerminal: string | null = null;
    let resolvedTo: string | null = null;
    for (const point of candidatePoints) {
      const junction = junctions.find(
        (j) => j.terminal === point || j.terminal.toUpperCase().startsWith(point.toUpperCase())
      );
      if (!junction) continue;
      const match = matchJunctionAnswer(transcript, junction);
      if (match) {
        resolvedTerminal = junction.terminal;
        resolvedTo = match.to;
        break;
      }
    }

    if (resolvedTerminal && resolvedTo) {
      updated = {
        ...updated,
        branchChoices: { ...(updated.branchChoices ?? {}), [resolvedTerminal]: resolvedTo },
        readingSteps: [],
      };
    }

    setSchematic(updated);
    await saveSchematic(updated);
    const confirmMsg = resolvedTerminal
      ? es
        ? `Nota guardada — bifurcación resuelta hacia ${resolvedTo}`
        : `Note saved — branch resolved toward ${resolvedTo}`
      : es
      ? 'Nota guardada'
      : 'Note saved';
    setNoteStatus(confirmMsg);
    speakText(confirmMsg);
    console.log('[Analyze] Note saved', { target, transcript, resolvedTerminal, resolvedTo });
    setTimeout(() => setNoteStatus(null), 2500);
  };

  const saveAsStandard = async () => {
    if (!schematic) return;
    setSavingStandard(true);
    try {
      const updated: SchematicAnalysis = { ...schematic, isStandard: true, standardName: schematic.name };
      setSchematic(updated);
      await saveSchematic(updated);
      console.log('[Analyze] Saved as standard', { id: schematic.id, name: schematic.name });
      Alert.alert(
        es ? 'Guardado como Estándar' : 'Saved as Standard',
        es
          ? 'Este esquema verificado ahora está disponible como referencia confiable para tu equipo.'
          : 'This verified schematic is now available as a trusted reference for your team.'
      );
    } catch (e) {
      console.error('[Analyze] Failed to save as standard', e);
      Alert.alert(es ? 'Error' : 'Error', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingStandard(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!schematic || !editTarget) return;
    setSavingEdit(true);
    try {
      let updated: SchematicAnalysis = schematic;

      if (editTarget.kind === 'wire') {
        const wires = schematic.wires.map((w) =>
          w.id === editTarget.id
            ? {
                ...w,
                label: editValues.label,
                color: editValues.color || undefined,
                fromPoint: editValues.fromPoint,
                toPoint: editValues.toPoint,
                voltage: editValues.voltage || undefined,
              }
            : w
        );
        updated = { ...schematic, wires, readingSteps: [] };
      } else if (editTarget.kind === 'newWire') {
        if (!editValues.label?.trim()) {
          Alert.alert(es ? 'Falta la etiqueta' : 'Missing label', es ? 'Ingresa una etiqueta para el cable.' : 'Enter a label for the wire.');
          setSavingEdit(false);
          return;
        }
        const newWire: WireInfo = {
          id: `wire_${Date.now()}`,
          label: editValues.label.trim(),
          color: editValues.color || undefined,
          fromPoint: editValues.fromPoint || '',
          toPoint: editValues.toPoint || '',
          voltage: editValues.voltage || undefined,
          confidence: 1,
        };
        const wires = [...schematic.wires, newWire];
        updated = { ...schematic, wires, wireCount: wires.length, readingSteps: [] };
      } else if (editTarget.kind === 'component') {
        const components = schematic.components.map((c) =>
          c.id === editTarget.id
            ? { ...c, label: editValues.label, type: editValues.type, description: editValues.description }
            : c
        );
        updated = { ...schematic, components, readingSteps: [] };
      } else if (editTarget.kind === 'newComponent') {
        if (!editValues.label?.trim()) {
          Alert.alert(es ? 'Falta la etiqueta' : 'Missing label', es ? 'Ingresa una etiqueta para el componente.' : 'Enter a label for the component.');
          setSavingEdit(false);
          return;
        }
        const newComponent: ComponentInfo = {
          id: `comp_${Date.now()}`,
          label: editValues.label.trim(),
          type: editValues.type || 'unknown',
          description: editValues.description || '',
          isUnknown: false,
          confidence: 1,
        };
        const components = [...schematic.components, newComponent];
        updated = { ...schematic, components, componentCount: components.length, readingSteps: [] };
      } else if (editTarget.kind === 'connection') {
        const connections = schematic.connections.map((c) =>
          c.id === editTarget.id
            ? {
                ...c,
                wireLabel: editValues.wireLabel,
                from: editValues.from,
                to: editValues.to,
                description: editValues.description,
              }
            : c
        );
        updated = { ...schematic, connections, readingSteps: [] };
      } else if (editTarget.kind === 'summary') {
        updated = { ...schematic, summary: editValues.summary, readingSteps: [] };
      }

      setSchematic(updated);
      await saveSchematic(updated);
      setCorrectionsMade((n) => n + 1);
      console.log('[Analyze] Edit saved', { kind: editTarget.kind });
      closeEdit();
    } catch (e) {
      console.error('[Analyze] Failed to save edit', e);
      Alert.alert(es ? 'Error al guardar' : 'Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteEdit = async () => {
    if (!schematic || !editTarget || editTarget.kind === 'summary' || editTarget.kind === 'newWire' || editTarget.kind === 'newComponent') return;
    setSavingEdit(true);
    try {
      let updated: SchematicAnalysis = schematic;

      if (editTarget.kind === 'wire') {
        const wires = schematic.wires.filter((w) => w.id !== editTarget.id);
        updated = { ...schematic, wires, wireCount: wires.length, readingSteps: [] };
      } else if (editTarget.kind === 'component') {
        const components = schematic.components.filter((c) => c.id !== editTarget.id);
        updated = { ...schematic, components, componentCount: components.length, readingSteps: [] };
      } else if (editTarget.kind === 'connection') {
        const connections = schematic.connections.filter((c) => c.id !== editTarget.id);
        updated = { ...schematic, connections, readingSteps: [] };
      }

      setSchematic(updated);
      await saveSchematic(updated);
      setCorrectionsMade((n) => n + 1);
      console.log('[Analyze] Item deleted', { kind: editTarget.kind });
      closeEdit();
    } catch (e) {
      console.error('[Analyze] Failed to delete item', e);
      Alert.alert(es ? 'Error al eliminar' : 'Delete failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
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

  const junctions = useMemo(
    () => (schematic ? findJunctions(schematic.connections) : []),
    [schematic]
  );

  const toggleBranchChoice = (terminal: string, to: string) => {
    setBranchChoices((prev) => {
      const next = { ...prev };
      if (next[terminal] === to) delete next[terminal];
      else next[terminal] = to;
      return next;
    });
  };

  const unknownCount = schematic?.unknownSymbols.filter((u) => !u.userIdentifiedAs).length ?? 0;
  const isHighContrast = uiPrefs.visualMode === 'highContrast';
  const isDark = uiPrefs.visualMode === 'dark';
  const isLightMode = uiPrefs.visualMode === 'normalLight';
  const activeVisionProviderLabel =
    uiPrefs.visionProvider === 'anthropic'
      ? 'Claude Sonnet 5'
      : uiPrefs.visionProvider === 'openrouter'
      ? 'OpenRouter'
      : uiPrefs.visionProvider === 'openai'
      ? 'GPT-4o'
      : uiPrefs.visionProvider === 'gemini'
      ? 'Gemini'
      : es
      ? 'Automático (Claude Sonnet 5 → GPT-4o → OpenRouter → Gemini)'
      : 'Auto (Claude Sonnet 5 → GPT-4o → OpenRouter → Gemini)';
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

  useSpeechRecognitionEvent('result', (event: any) => {
    if (!correctionActiveRef.current && !noteActiveRef.current) return;
    const rawResults = Array.isArray(event?.results) ? event.results : [];
    for (let i = rawResults.length - 1; i >= 0; i -= 1) {
      const text = rawResults[i]?.transcript;
      if (typeof text === 'string' && text.trim()) {
        if (correctionActiveRef.current) correctionTranscriptRef.current = text.trim();
        if (noteActiveRef.current) noteTranscriptRef.current = text.trim();
        break;
      }
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (correctionListening) {
      setCorrectionListening(false);
    }
    if (noteListening) {
      setNoteListening(false);
    }
    if (correctionTargetRef.current) {
      processVoiceCorrectionResult();
    }
    if (noteTargetRef.current) {
      processNoteResult();
    }
  });

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
        <View style={styles.headerCenter}>
          <PulsingLogo size={18} />
          <Text style={[styles.headerTitle, isLightMode && styles.headerTitleLight, isDark && styles.headerTitleDark]}>{es ? 'Analizar Esquema' : 'Analyze Schematic'}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Image */}
        {(params.imageUri || schematic?.imageUri) && (
          <View style={[styles.imageContainer, { height: schematicImageHeight }]}>
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
            <AnalysisProgressBar progress={progressAnim} />
            {progressStage ? <Text style={styles.progressStageText}>{progressStage}</Text> : null}
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
                <View style={styles.summaryHeader}>
                  <Text style={styles.summaryLabel}>{es ? 'Resumen AI' : 'AI Summary'}</Text>
                  <AnimatedPressable onPress={openEditSummary} style={styles.editIconBtn} scaleValue={0.9}>
                    <Pencil size={14} color={WT.textSecondary} />
                  </AnimatedPressable>
                </View>
                <Text style={styles.summaryText}>{schematic.summary}</Text>
              </View>
            ) : null}

            <AnimatedPressable
              onPress={() => {
                console.log('[Analyze] View diagram pressed');
                router.push({ pathname: '/schematic-view', params: { schematicId: schematic.id } });
              }}
              style={styles.diagramBtn}
              scaleValue={0.97}
            >
              <GitBranch size={18} color={WT.blue} />
              <View style={{ flex: 1 }}>
                <Text style={styles.diagramBtnText}>{es ? 'Ver Diagrama Limpio' : 'View Clean Diagram'}</Text>
                <Text style={styles.diagramBtnSub}>
                  {es ? 'Cables y componentes sin la foto original' : 'Wires and components without the original photo'}
                </Text>
              </View>
            </AnimatedPressable>

            {schematic.isStandard ? (
              <View style={styles.standardBadgeBanner}>
                <CheckCircle size={16} color={WT.green} />
                <Text style={styles.standardBadgeText}>
                  {es ? 'Guardado como estándar verificado' : 'Saved as a verified standard'}
                </Text>
              </View>
            ) : (
              correctionsMade > 0 &&
              !standardPromptDismissed && (
                <View style={styles.standardPromptBanner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.standardPromptTitle}>
                      {es ? '¿Guardar como Estándar?' : 'Save as a Standard?'}
                    </Text>
                    <Text style={styles.standardPromptText}>
                      {es
                        ? 'Ya corregiste este esquema — guárdalo como referencia confiable para entrenar a tu equipo.'
                        : "You've corrected this schematic — save it as a trusted reference to train your team."}
                    </Text>
                  </View>
                  <View style={{ gap: 6 }}>
                    <AnimatedPressable onPress={saveAsStandard} style={styles.standardSaveBtn} disabled={savingStandard} scaleValue={0.95}>
                      <Text style={styles.standardSaveBtnText}>
                        {savingStandard ? (es ? 'Guardando...' : 'Saving...') : es ? 'Guardar' : 'Save'}
                      </Text>
                    </AnimatedPressable>
                    <AnimatedPressable onPress={() => setStandardPromptDismissed(true)} style={styles.standardDismissBtn} scaleValue={0.95}>
                      <Text style={styles.standardDismissBtnText}>{es ? 'Ahora no' : 'Not now'}</Text>
                    </AnimatedPressable>
                  </View>
                </View>
              )
            )}

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
                {es
                  ? 'Toca una fila para resaltarla y luego mantenla presionada para decir una corrección en voz alta, o usa el lápiz ✎ para escribirla.'
                  : 'Tap a row to highlight and then press and hold down to speak a correction or use pencil to type it in.'}
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
                <View style={{ flex: 1 }} />
                <AnimatedPressable onPress={openAddWire} style={styles.addWireBtn} scaleValue={0.92}>
                  <Plus size={14} color={WT.blue} />
                  <Text style={styles.addWireBtnText}>{es ? 'Agregar' : 'Add Wire'}</Text>
                </AnimatedPressable>
              </View>
              {schematic.wires.length === 0 ? (
                <Text style={styles.emptyCardText}>{es ? 'No se detectaron cables' : 'No wires detected'}</Text>
              ) : (
                schematic.wires.slice(0, wiresExpanded ? schematic.wires.length : wireDisplayLimit).map((wire) => (
                  <AnimatedPressable
                    key={wire.id}
                    onPress={() => toggleHighlight(`wire:${wire.id}`)}
                    onLongPress={() => startVoiceCorrection({ kind: 'wire', id: wire.id })}
                    onPressOut={stopVoiceCorrection}
                    style={[
                      styles.wireRow,
                      highlightKey === `wire:${wire.id}` && styles.highlightedRow,
                      correctionListening && targetMatches(correctionTargetRef.current, 'wire', wire.id) && styles.correctionActiveRow,
                    ]}
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
                    {wire.userNote ? (
                      <AnimatedPressable
                        onPress={() => {
                          if (uiPrefs.notesVisible) {
                            Alert.alert(es ? 'Nota de Voz' : 'Voice Note', wire.userNote);
                          } else {
                            speakText(wire.userNote!);
                          }
                        }}
                        style={styles.noteBadgeBtn}
                        scaleValue={0.9}
                      >
                        <StickyNote size={13} color={WT.yellow} />
                      </AnimatedPressable>
                    ) : null}
                    <AnimatedPressable
                      onLongPress={() => startNoteRecording({ kind: 'wire', id: wire.id })}
                      onPressOut={stopNoteRecording}
                      style={[
                        styles.editIconBtn,
                        noteListening && targetMatches(noteTargetRef.current, 'wire', wire.id) && styles.correctionActiveRow,
                      ]}
                      scaleValue={0.9}
                    >
                      <Mic size={13} color={noteListening && targetMatches(noteTargetRef.current, 'wire', wire.id) ? WT.green : WT.textSecondary} />
                    </AnimatedPressable>
                    <AnimatedPressable onPress={() => openEditWire(wire)} style={styles.editIconBtn} scaleValue={0.9}>
                      <Pencil size={14} color={WT.textSecondary} />
                    </AnimatedPressable>
                  </AnimatedPressable>
                ))
              )}
              {schematic.wires.length > wireDisplayLimit && (
                <AnimatedPressable
                  onPress={() => setWiresExpanded((v) => !v)}
                  style={styles.moreBtn}
                  scaleValue={0.97}
                >
                  <Text style={styles.moreText}>
                    {wiresExpanded
                      ? es
                        ? 'Mostrar menos'
                        : 'Show less'
                      : es
                      ? `+${schematic.wires.length - wireDisplayLimit} cables más — toca para ver y corregir`
                      : `+${schematic.wires.length - wireDisplayLimit} more wires — tap to view & correct`}
                  </Text>
                </AnimatedPressable>
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
                <View style={{ flex: 1 }} />
                <AnimatedPressable onPress={openAddComponent} style={styles.addWireBtn} scaleValue={0.92}>
                  <Plus size={14} color={WT.blue} />
                  <Text style={styles.addWireBtnText}>{es ? 'Agregar' : 'Add Component'}</Text>
                </AnimatedPressable>
              </View>
              {schematic.components.length === 0 ? (
                <Text style={styles.emptyCardText}>{es ? 'No se detectaron componentes' : 'No components detected'}</Text>
              ) : (
                schematic.components.map((comp) => (
                  <AnimatedPressable
                    key={comp.id}
                    onPress={() => toggleHighlight(`component:${comp.id}`)}
                    onLongPress={() => startVoiceCorrection({ kind: 'component', id: comp.id })}
                    onPressOut={stopVoiceCorrection}
                    style={[
                      styles.componentRow,
                      highlightKey === `component:${comp.id}` && styles.highlightedRow,
                      correctionListening && targetMatches(correctionTargetRef.current, 'component', comp.id) && styles.correctionActiveRow,
                    ]}
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
                      <View style={{ flex: 1 }} />
                      {comp.userNote ? (
                        <AnimatedPressable
                          onPress={() => {
                            if (uiPrefs.notesVisible) {
                              Alert.alert(es ? 'Nota de Voz' : 'Voice Note', comp.userNote);
                            } else {
                              speakText(comp.userNote!);
                            }
                          }}
                          style={styles.noteBadgeBtn}
                          scaleValue={0.9}
                        >
                          <StickyNote size={13} color={WT.yellow} />
                        </AnimatedPressable>
                      ) : null}
                      <AnimatedPressable
                        onLongPress={() => startNoteRecording({ kind: 'component', id: comp.id })}
                        onPressOut={stopNoteRecording}
                        style={[
                          styles.editIconBtn,
                          noteListening && targetMatches(noteTargetRef.current, 'component', comp.id) && styles.correctionActiveRow,
                        ]}
                        scaleValue={0.9}
                      >
                        <Mic size={13} color={noteListening && targetMatches(noteTargetRef.current, 'component', comp.id) ? WT.green : WT.textSecondary} />
                      </AnimatedPressable>
                      <AnimatedPressable onPress={() => openEditComponent(comp)} style={styles.editIconBtn} scaleValue={0.9}>
                        <Pencil size={14} color={WT.textSecondary} />
                      </AnimatedPressable>
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
                schematic.connections.slice(0, connectionsExpanded ? schematic.connections.length : connectionDisplayLimit).map((conn) => (
                  <AnimatedPressable
                    key={conn.id}
                    onPress={() => toggleHighlight(`connection:${conn.id}`)}
                    onLongPress={() => startVoiceCorrection({ kind: 'connection', id: conn.id })}
                    onPressOut={stopVoiceCorrection}
                    style={[
                      styles.connectionRow,
                      highlightKey === `connection:${conn.id}` && styles.highlightedRow,
                      correctionListening && targetMatches(correctionTargetRef.current, 'connection', conn.id) && styles.correctionActiveRow,
                    ]}
                    scaleValue={0.99}
                  >
                    <View style={styles.connectionRowTop}>
                      <Text style={[styles.connectionWire, isDark && styles.darkPrimaryText]}>{conn.wireLabel}</Text>
                      <View style={{ flex: 1 }} />
                      <AnimatedPressable onPress={() => openEditConnection(conn)} style={styles.editIconBtn} scaleValue={0.9}>
                        <Pencil size={14} color={WT.textSecondary} />
                      </AnimatedPressable>
                    </View>
                    <Text style={[styles.connectionDesc, isDark && styles.darkSecondaryText]} numberOfLines={2}>
                      {conn.description}
                    </Text>
                  </AnimatedPressable>
                ))
              )}
              {schematic.connections.length > connectionDisplayLimit && (
                <AnimatedPressable
                  onPress={() => setConnectionsExpanded((v) => !v)}
                  style={styles.moreBtn}
                  scaleValue={0.97}
                >
                  <Text style={styles.moreText}>
                    {connectionsExpanded
                      ? es
                        ? 'Mostrar menos'
                        : 'Show less'
                      : es
                      ? `+${schematic.connections.length - connectionDisplayLimit} conexiones más — toca para ver y corregir`
                      : `+${schematic.connections.length - connectionDisplayLimit} more connections — tap to view & correct`}
                  </Text>
                </AnimatedPressable>
              )}
            </View>

            {/* Ambiguous start point warning */}
            {schematic.startPointAmbiguous && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={18} color={WT.yellow} />
                <Text style={styles.warningText}>
                  {es
                    ? 'Este esquema no tiene un punto de inicio obvio (sin "Línea 1" clara). Elige "Cable/Componente Específico" abajo, o te preguntaremos por voz al comenzar la lectura.'
                    : 'This schematic doesn\'t have an obvious starting point (no clear "Line 1"). Choose "Specific Wire/Component" below, or we\'ll ask you by voice when reading starts.'}
                </Text>
              </View>
            )}

            {/* High Detail coverage — how much of the drawing the three passes actually got through */}
            {schematic.scanCoverage && (
              <View style={styles.warningBanner}>
                {schematic.scanCoverage.unplacedNumbers.length > 0 || schematic.scanCoverage.unnumberedEdges > 0 ? (
                  <AlertTriangle size={18} color={WT.yellow} />
                ) : (
                  <CheckCircle size={18} color={WT.green} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningText}>
                    {es
                      ? `Escaneo de Alto Detalle: ${schematic.scanCoverage.numbersFound} números de cable encontrados, ${schematic.scanCoverage.numbersPlaced} colocados en un cable, ${schematic.scanCoverage.unplacedNumbers.length} sin colocar.`
                      : `High Detail scan: found ${schematic.scanCoverage.numbersFound} wire number${schematic.scanCoverage.numbersFound === 1 ? '' : 's'}, placed ${schematic.scanCoverage.numbersPlaced}, ${schematic.scanCoverage.unplacedNumbers.length} unplaced.`}
                  </Text>
                  <Text style={styles.warningText}>
                    {es
                      ? `${schematic.scanCoverage.componentsFound} componentes y ${schematic.scanCoverage.edgesTraced} conductores rastreados.`
                      : `${schematic.scanCoverage.componentsFound} components and ${schematic.scanCoverage.edgesTraced} conductors traced.`}
                  </Text>
                </View>
              </View>
            )}

            {/* Structural consistency warnings — caught deterministically, not by the AI itself */}
            {schematic.validationWarnings && schematic.validationWarnings.length > 0 && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={18} color={WT.yellow} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningText}>
                    {es
                      ? `Se detectaron ${schematic.validationWarnings.length} posibles inconsistencias — revisa antes de confiar en la lectura:`
                      : `${schematic.validationWarnings.length} possible inconsistenc${schematic.validationWarnings.length === 1 ? 'y' : 'ies'} detected — review before relying on the reading:`}
                  </Text>
                  {schematic.validationWarnings.map((w, i) => (
                    <Text key={i} style={styles.warningText}>
                      {'• '}{w}
                    </Text>
                  ))}
                </View>
              </View>
            )}

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
                {(['beginning', 'end', 'specific', 'custom'] as StartPoint[]).map((opt) => {
                  const labels: Record<StartPoint, string> = es
                    ? {
                        beginning: 'Desde el Principio',
                        end: 'Desde el Final',
                        specific: 'Cable/Componente Específico',
                        custom: 'Orden Personalizado',
                      }
                    : {
                        beginning: 'From Beginning',
                        end: 'From End',
                        specific: 'Specific Wire/Component',
                        custom: 'Custom Order',
                      };
                  return (
                    <AnimatedPressable
                      key={opt}
                      onPress={() => {
                        console.log('[Analyze] Start point selected', { opt });
                        setStartPoint(opt);
                        setStartPointTouched(true);
                        if (opt === 'specific') setShowStartPicker(true);
                        if (opt === 'custom' && schematic) {
                          router.push({ pathname: '/custom-reading-order', params: { schematicId: schematic.id } });
                        }
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

              {startPoint === 'custom' && (
                <View style={styles.specificPicker}>
                  <AnimatedPressable
                    onPress={() => {
                      if (schematic) {
                        router.push({ pathname: '/custom-reading-order', params: { schematicId: schematic.id } });
                      }
                    }}
                    style={styles.pickerToggle}
                  >
                    <Search size={16} color={WT.textSecondary} />
                    <Text style={[styles.pickerToggleText, (schematic?.customWireOrder?.length ?? 0) > 0 && { color: WT.textPrimary }]}>
                      {(schematic?.customWireOrder?.length ?? 0) > 0
                        ? es
                          ? `${schematic!.customWireOrder!.length} cables seleccionados — toca para editar`
                          : `${schematic!.customWireOrder!.length} wires selected — tap to edit`
                        : es
                        ? 'Toca para elegir y ordenar cables...'
                        : 'Tap to pick & order wires...'}
                    </Text>
                  </AnimatedPressable>
                </View>
              )}

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

            {/* Path Decisions — branch points detected in the wiring graph */}
            {junctions.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <GitBranch size={16} color={WT.blue} />
                  <Text style={styles.cardTitle}>{es ? 'Decisiones de Ruta' : 'Path Decisions'}</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{junctions.length}</Text>
                  </View>
                </View>
                <Text style={styles.aiHelperText}>
                  {es
                    ? 'El cableado se divide en estos puntos. Elige una dirección ahora, o déjalo sin elegir y te preguntaremos por voz al llegar ahí.'
                    : 'The wiring splits at these points. Pick a direction now, or leave it unset and we\'ll ask by voice when reading gets there.'}
                </Text>
                {junctions.map((junction) => (
                  <View key={junction.terminal} style={styles.junctionBlock}>
                    <Text style={styles.junctionTerminal}>{junction.terminal}</Text>
                    {junction.options.map((opt) => {
                      const selected = branchChoices[junction.terminal] === opt.to;
                      return (
                        <AnimatedPressable
                          key={opt.to}
                          onPress={() => toggleBranchChoice(junction.terminal, opt.to)}
                          style={[styles.junctionOpt, selected && styles.junctionOptActive]}
                          scaleValue={0.98}
                        >
                          <View style={[styles.startOptRadio, selected && styles.startOptRadioActive]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.junctionOptWire, selected && styles.junctionOptWireActive]}>
                              {es ? `Cable ${opt.wireLabel} → ${opt.to}` : `Wire ${opt.wireLabel} → ${opt.to}`}
                            </Text>
                            {opt.description ? (
                              <Text style={styles.junctionOptDesc} numberOfLines={2}>
                                {opt.description}
                              </Text>
                            ) : null}
                          </View>
                        </AnimatedPressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Start Reading button */}
      {schematic && !loading && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          {generatingSteps ? (
            <View style={{ marginBottom: 10 }}>
              <AnalysisProgressBar progress={stepsProgressAnim} />
            </View>
          ) : null}
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

      {/* Voice correction / note status */}
      {(correctionListening || correctionBusy || correctionStatus) && (
        <View style={styles.correctionBanner}>
          <Mic size={18} color={correctionListening ? WT.green : WT.textSecondary} />
          <Text style={styles.correctionBannerText}>
            {correctionStatus ||
              (correctionListening ? (es ? 'Escuchando...' : 'Listening...') : es ? 'Procesando...' : 'Processing...')}
          </Text>
        </View>
      )}
      {(noteListening || noteStatus) && !correctionListening && !correctionStatus && (
        <View style={styles.correctionBanner}>
          <StickyNote size={18} color={noteListening ? WT.yellow : WT.textSecondary} />
          <Text style={styles.correctionBannerText}>
            {noteStatus || (es ? 'Grabando nota...' : 'Recording note...')}
          </Text>
        </View>
      )}

      {/* Edit / correction modal */}
      <Modal visible={editTarget !== null} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editTarget ? (es ? EDIT_TITLES[editTarget.kind].es : EDIT_TITLES[editTarget.kind].en) : ''}
              </Text>
              <AnimatedPressable onPress={closeEdit} style={styles.modalCloseBtn} scaleValue={0.9}>
                <X size={20} color={WT.textSecondary} />
              </AnimatedPressable>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              {editTarget &&
                EDIT_FIELDS[editTarget.kind].map((field) => (
                  <View key={field.key} style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>{es ? field.labelEs : field.label}</Text>
                    <TextInput
                      style={[styles.modalInput, field.multiline && styles.modalInputMultiline]}
                      value={editValues[field.key] ?? ''}
                      onChangeText={(t) => setEditValues((prev) => ({ ...prev, [field.key]: t }))}
                      multiline={field.multiline}
                      placeholderTextColor={WT.textTertiary}
                    />
                  </View>
                ))}
            </ScrollView>

            <View style={styles.modalActions}>
              {editTarget && editTarget.kind !== 'summary' && editTarget.kind !== 'newWire' && editTarget.kind !== 'newComponent' && (
                <AnimatedPressable onPress={handleDeleteEdit} style={styles.modalDeleteBtn} disabled={savingEdit} scaleValue={0.95}>
                  <Trash2 size={16} color={WT.red} />
                  <Text style={styles.modalDeleteText}>{es ? 'Eliminar' : 'Delete'}</Text>
                </AnimatedPressable>
              )}
              <View style={{ flex: 1 }} />
              <AnimatedPressable onPress={closeEdit} style={styles.modalCancelBtn} disabled={savingEdit} scaleValue={0.95}>
                <Text style={styles.modalCancelText}>{es ? 'Cancelar' : 'Cancel'}</Text>
              </AnimatedPressable>
              <AnimatedPressable onPress={handleSaveEdit} style={styles.modalSaveBtn} disabled={savingEdit} scaleValue={0.95}>
                <Text style={styles.modalSaveText}>
                  {savingEdit ? (es ? 'Guardando...' : 'Saving...') : es ? 'Guardar' : 'Save'}
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    // The schematic is the thing the electrician is actually reading, so it
    // gets the screen. Pulling back most of the scroll padding leaves a hairline
    // gap at the edges instead of a 16px frame; the height comes from the
    // window at render time.
    marginHorizontal: -12,
    marginTop: -12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
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
  progressTrack: {
    width: '100%',
    height: 16,
    borderRadius: 8,
    backgroundColor: WT.blueMuted,
    borderWidth: 1,
    borderColor: WT.blueDim,
    overflow: 'hidden',
    marginTop: 8,
    justifyContent: 'center',
  },
  progressGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: WT.blue,
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: WT.pink,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    shadowColor: WT.pink,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  progressTip: {
    width: 16,
    height: '100%',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: WT.pinkBright,
  },
  progressStageText: {
    fontSize: 12,
    color: WT.pink,
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
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  highlightedRow: {
    backgroundColor: WT.blueMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.blue,
  },
  correctionActiveRow: {
    backgroundColor: WT.greenMuted,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: WT.green,
  },
  noteBadgeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.yellowMuted,
  },
  correctionBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.green,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  correctionBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textPrimary,
    flex: 1,
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
  addWireBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: WT.blueMuted,
  },
  addWireBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: WT.blue,
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
  moreBtn: {
    paddingVertical: 6,
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
  connectionRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
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
  junctionBlock: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: WT.border,
  },
  junctionTerminal: {
    fontSize: 12,
    fontWeight: '700',
    color: WT.textSecondary,
    fontFamily: 'SpaceMono',
  },
  junctionOpt: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: WT.bgCardAlt,
    borderWidth: 1,
    borderColor: WT.border,
  },
  junctionOptActive: {
    backgroundColor: WT.blueMuted,
    borderColor: WT.blue,
  },
  junctionOptWire: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textSecondary,
  },
  junctionOptWireActive: {
    color: WT.blue,
  },
  junctionOptDesc: {
    fontSize: 11,
    color: WT.textTertiary,
    marginTop: 2,
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
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  diagramBtn: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: WT.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  diagramBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  diagramBtnSub: {
    fontSize: 11.5,
    color: WT.textSecondary,
  },
  standardBadgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: WT.greenMuted,
    borderWidth: 1,
    borderColor: WT.green,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  standardBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.green,
  },
  standardPromptBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.blue,
    borderRadius: 14,
    padding: 14,
  },
  standardPromptTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: WT.textPrimary,
    marginBottom: 3,
  },
  standardPromptText: {
    fontSize: 12,
    color: WT.textSecondary,
    lineHeight: 17,
  },
  standardSaveBtn: {
    backgroundColor: WT.blue,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  standardSaveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  standardDismissBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  standardDismissBtnText: {
    fontSize: 12,
    color: WT.textSecondary,
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
  editIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.bgCardAlt,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: WT.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.bgCardAlt,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  modalField: {
    gap: 6,
    marginBottom: 16,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: WT.textSecondary,
  },
  modalInput: {
    backgroundColor: WT.bgInput,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: WT.textPrimary,
  },
  modalInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
  modalDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: WT.redMuted,
  },
  modalDeleteText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.red,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: WT.bgCardAlt,
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textSecondary,
  },
  modalSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: WT.blue,
  },
  modalSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
