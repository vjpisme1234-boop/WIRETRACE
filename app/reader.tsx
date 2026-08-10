import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import {
  ArrowLeft,
  CheckCircle,
  ChevronLeft,
  Mic,
  MicOff,
  Volume2,
} from 'lucide-react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { WT } from '@/constants/wiretrace';
import { getSchematic, saveSchematic, ReadingStep, SchematicAnalysis } from '@/utils/schematic-storage';
import { answerSchematicQuestion, continueReadingSteps, generateReadingSteps } from '@/utils/openrouter';
import { getUncoveredWires, JunctionChoice, JunctionOption, matchJunctionAnswer } from '@/utils/schematic-graph';
import { loadTTSSettings, speakText, stopSpeech } from '@/utils/tts';
import { DEFAULT_UI_PREFERENCES, loadUIPreferences, ReadingStyle } from '@/utils/ui-preferences';
import PulsingLogo from '@/components/PulsingLogo';

const WIRE_COLOR_MAP: Record<string, string> = {
  red: '#FF3B30',
  black: '#3A3A3C',
  white: '#FFFFFF',
  blue: '#007AFF',
  yellow: '#FFD60A',
  green: '#34C759',
  orange: '#FF9500',
  brown: '#A2845E',
  purple: '#AF52DE',
  violet: '#AF52DE',
  gray: '#8E8E93',
  grey: '#8E8E93',
  pink: '#FF2D55',
  'green-yellow': '#B8E000',
};

function normalizeWireLabel(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^wire\s+/, '')
    .trim();
}

function getStepWireColor(step: ReadingStep, schematic: SchematicAnalysis | null): string | null {
  if (!schematic || !step.wireLabel) return null;
  const label = normalizeWireLabel(step.wireLabel);
  const match = schematic.wires.find((wire) => normalizeWireLabel(wire.label) === label);
  if (!match?.color) return null;
  return WIRE_COLOR_MAP[match.color.toLowerCase()] || null;
}

/**
 * Alternate step phrasings, used in place of the full AI instruction:
 *  - brief: "<wire#> from <point> to <point>"
 *  - destinationOnly: "Wire number <wire#> to <point>" (source point omitted)
 * Falls back to the normal instruction for steps that aren't tied to a wire
 * with known endpoints (e.g. component-only steps).
 */
function getStepInstructionText(
  step: ReadingStep,
  schematic: SchematicAnalysis | null,
  readingStyle: ReadingStyle,
  isSpanish: boolean
): string {
  if (readingStyle !== 'detailed' && step.wireLabel && schematic) {
    const label = normalizeWireLabel(step.wireLabel);
    const wire = schematic.wires.find((w) => normalizeWireLabel(w.label) === label);
    if (readingStyle === 'brief' && wire?.fromPoint && wire?.toPoint) {
      return isSpanish
        ? `${wire.label} de ${wire.fromPoint} a ${wire.toPoint}`
        : `${wire.label} from ${wire.fromPoint} to ${wire.toPoint}`;
    }
    if (readingStyle === 'destinationOnly' && wire?.toPoint) {
      return isSpanish
        ? `Cable número ${wire.label} a ${wire.toPoint}`
        : `Wire number ${wire.label} to ${wire.toPoint}`;
    }
  }
  return step.instruction;
}

function AnimatedPressable({
  onPress,
  style,
  children,
  scaleValue = 0.95,
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
    <Animated.View style={[{ transform: [{ scale }] }, disabled && { opacity: 0.4 }]}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} disabled={disabled} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default function ReaderScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ schematicId: string; direction: string; startLabel: string; needsStartPrompt?: string }>();

  const [steps, setSteps] = useState<ReadingStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [voiceNextEnabled, setVoiceNextEnabled] = useState(true);
  const [listeningForVoice, setListeningForVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Say "next" when ready');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [uiPrefs, setUiPrefs] = useState(DEFAULT_UI_PREFERENCES);
  const [schematicForHelp, setSchematicForHelp] = useState<SchematicAnalysis | null>(null);
  const [speechLanguage, setSpeechLanguage] = useState<'english' | 'spanish'>('english');
  const [awaitingStartAnswer, setAwaitingStartAnswer] = useState(false);
  const [pendingJunction, setPendingJunction] = useState<JunctionChoice | null>(null);
  const [resolvingJunction, setResolvingJunction] = useState(false);
  const [continuingUncovered, setContinuingUncovered] = useState(false);

  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(20)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const waitingForVoiceRef = useRef(false);
  const commandHandledRef = useRef(false);
  const listeningModeRef = useRef<'command' | 'helpQuestion' | 'startPrompt' | 'junctionPrompt'>('command');

  const animateIn = useCallback(() => {
    contentOpacity.setValue(0);
    contentTranslate.setValue(20);
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(contentTranslate, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [contentOpacity, contentTranslate]);

  useEffect(() => {
    const load = async () => {
      console.log('[Reader] Loading schematic', { id: params.schematicId });
      const schematic = await getSchematic(params.schematicId);
      if (!schematic) {
        console.error('[Reader] Schematic not found');
        router.back();
        return;
      }
      setSchematicForHelp(schematic);
      setPendingJunction(schematic.pendingJunction ?? null);

      if (params.needsStartPrompt === '1' && schematic.readingSteps.length === 0) {
        console.log('[Reader] Start point deferred — will ask by voice');
        setLoading(false);
        setAwaitingStartAnswer(true);
        return;
      }

      let stepsToUse = schematic.readingSteps;
      if (params.direction === 'backward') {
        stepsToUse = [...stepsToUse].reverse().map((s, i) => ({ ...s, stepNumber: i + 1 }));
      }

      setSteps(stepsToUse);
      setLoading(false);
      console.log('[Reader] Steps loaded', { count: stepsToUse.length });
    };
    load();
  }, [params.direction, params.needsStartPrompt, params.schematicId]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      loadUIPreferences()
        .then((prefs) => {
          if (isMounted) setUiPrefs(prefs);
        })
        .catch((error) => {
          console.error('[Reader] Failed to refresh UI preferences', error);
        });
      return () => {
        isMounted = false;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      loadTTSSettings()
        .then((settings) => {
          if (isMounted) {
            setSpeechLanguage(settings.language);
            setVoiceStatus(
              settings.language === 'spanish' ? 'Di "siguiente" cuando estés listo' : 'Say "next" when ready'
            );
          }
        })
        .catch((error) => {
          console.error('[Reader] Failed to load TTS settings', error);
        });
      return () => {
        isMounted = false;
      };
    }, [])
  );

  const stopVoiceListening = useCallback(() => {
    waitingForVoiceRef.current = false;
    setListeningForVoice(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      console.error('[Reader] Failed to stop voice recognition', error);
    }
  }, []);

  const startVoiceListening = useCallback(async (mode: 'command' | 'helpQuestion' | 'startPrompt' | 'junctionPrompt' = 'command') => {
    if (!voiceNextEnabled) return;
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setVoiceError('Voice recognition is unavailable on this device.');
      return;
    }

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setVoiceError('Microphone permission is required for voice "next".');
      return;
    }

    setVoiceError(null);
    listeningModeRef.current = mode;
    setVoiceStatus(
      mode === 'command'
        ? speechLanguage === 'spanish'
          ? 'Escuchando... di "siguiente", "regresa", o "ayuda"'
          : 'Listening... say "next", "go back", or "help"'
        : mode === 'helpQuestion'
        ? speechLanguage === 'spanish'
          ? 'Escuchando... dime qué necesitas'
          : 'Listening... tell me what you need help with'
        : mode === 'startPrompt'
        ? speechLanguage === 'spanish'
          ? 'Escuchando... di dónde empezar'
          : 'Listening... say where to start'
        : speechLanguage === 'spanish'
        ? 'Escuchando... elige una dirección'
        : 'Listening... choose a direction'
    );
    setListeningForVoice(true);
    waitingForVoiceRef.current = true;
    commandHandledRef.current = false;
    ExpoSpeechRecognitionModule.start({
      lang: speechLanguage === 'spanish' ? 'es-US' : 'en-US',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      contextualStrings:
        mode === 'command'
          ? speechLanguage === 'spanish'
            ? ['siguiente', 'continuar', 'regresa', 'atras', 'repite', 'ayuda']
            : ['next', 'go next', 'continue', 'go back', 'previous', 'back', 'repeat', 'help']
          : mode === 'junctionPrompt' && pendingJunction
          ? pendingJunction.options.map((o) => o.wireLabel)
          : undefined,
    });
  }, [voiceNextEnabled, speechLanguage, pendingJunction]);

  const parseTranscript = (event: any): string => {
    const rawResults = Array.isArray(event?.results) ? event.results : [];
    for (let i = rawResults.length - 1; i >= 0; i -= 1) {
      const text = rawResults[i]?.transcript;
      if (typeof text === 'string' && text.trim()) return text.trim().toLowerCase();
    }
    return '';
  };

  const resolveStartPoint = useCallback(async (label: string) => {
    if (!schematicForHelp) return;
    setAwaitingStartAnswer(false);
    setLoading(true);
    setVoiceStatus(speechLanguage === 'spanish' ? 'Generando pasos...' : 'Generating steps...');
    console.log('[Reader] Resolving deferred start point', { label });
    try {
      const dir: 'forward' | 'backward' = params.direction === 'backward' ? 'backward' : 'forward';
      const { steps: newSteps, pendingChoice } = await generateReadingSteps(
        {
          wires: schematicForHelp.wires,
          components: schematicForHelp.components,
          connections: schematicForHelp.connections,
          unknownSymbols: schematicForHelp.unknownSymbols,
          summary: '',
        },
        dir,
        label,
        schematicForHelp.branchChoices
      );

      const updated: SchematicAnalysis = {
        ...schematicForHelp,
        readingSteps: newSteps,
        pendingJunction: pendingChoice,
        startPointAmbiguous: false,
      };
      await saveSchematic(updated);
      setSchematicForHelp(updated);
      setPendingJunction(pendingChoice);

      let stepsToUse = newSteps;
      if (dir === 'backward') {
        stepsToUse = [...stepsToUse].reverse().map((s, i) => ({ ...s, stepNumber: i + 1 }));
      }
      setSteps(stepsToUse);
      setCurrentIndex(0);
    } catch (e) {
      console.error('[Reader] Failed to generate steps from voice start point', e);
      setVoiceError(
        speechLanguage === 'spanish' ? 'No se pudieron generar los pasos.' : 'Failed to generate steps.'
      );
    } finally {
      setLoading(false);
    }
  }, [schematicForHelp, params.direction, speechLanguage]);

  const askForStartPoint = useCallback(async () => {
    if (!schematicForHelp) return;
    const question =
      speechLanguage === 'spanish'
        ? 'Este esquema no tiene un punto de inicio claro. Di el número de un cable o el nombre de un componente para empezar ahí, o di "principio" para usar el orden por defecto.'
        : 'This schematic doesn\'t have a clear starting point. Say a wire number or component name to start there, or say "beginning" to use the default order.';

    const canListen = voiceNextEnabled && ExpoSpeechRecognitionModule.isRecognitionAvailable();
    if (!canListen) {
      console.log('[Reader] Voice unavailable for start prompt — using default start label');
      void resolveStartPoint(params.startLabel || 'Line 1');
      return;
    }

    setVoiceStatus(speechLanguage === 'spanish' ? 'Preguntando punto de inicio...' : 'Asking for a starting point...');
    await speakText(question, () => {
      startVoiceListening('startPrompt');
    });
  }, [schematicForHelp, speechLanguage, voiceNextEnabled, params.startLabel, resolveStartPoint, startVoiceListening]);

  const resolveJunctionChoice = useCallback(async (option: JunctionOption) => {
    if (!schematicForHelp || !pendingJunction) return;
    setResolvingJunction(true);
    setVoiceStatus(speechLanguage === 'spanish' ? 'Continuando...' : 'Continuing...');
    console.log('[Reader] Resolving junction', { terminal: pendingJunction.terminal, to: option.to });
    try {
      const dir: 'forward' | 'backward' = params.direction === 'backward' ? 'backward' : 'forward';
      const priorGenerationOrderSteps = schematicForHelp.readingSteps;

      const { steps: newSteps, pendingChoice } = await continueReadingSteps(
        {
          wires: schematicForHelp.wires,
          components: schematicForHelp.components,
          connections: schematicForHelp.connections,
          unknownSymbols: schematicForHelp.unknownSymbols,
          summary: '',
        },
        dir,
        priorGenerationOrderSteps,
        pendingJunction.terminal,
        option.to
      );

      const updatedBranchChoices = { ...(schematicForHelp.branchChoices || {}), [pendingJunction.terminal]: option.to };
      const updatedGenerationOrderSteps = [...priorGenerationOrderSteps, ...newSteps];
      const updated: SchematicAnalysis = {
        ...schematicForHelp,
        readingSteps: updatedGenerationOrderSteps,
        pendingJunction: pendingChoice,
        branchChoices: updatedBranchChoices,
      };
      await saveSchematic(updated);
      setSchematicForHelp(updated);
      setPendingJunction(pendingChoice);

      const newDisplaySteps = dir === 'backward' ? [...newSteps].reverse() : newSteps;
      setSteps((prev) => {
        const appended = [...prev, ...newDisplaySteps];
        return appended.map((s, i) => ({ ...s, stepNumber: i + 1 }));
      });
      setCurrentIndex((i) => i + 1);
    } catch (e) {
      console.error('[Reader] Failed to continue reading steps', e);
      setVoiceError(
        speechLanguage === 'spanish'
          ? 'No se pudo continuar. Toca el micro para intentar de nuevo.'
          : 'Could not continue. Tap the mic to try again.'
      );
    } finally {
      setResolvingJunction(false);
    }
  }, [schematicForHelp, pendingJunction, params.direction, speechLanguage]);

  const askJunctionQuestion = useCallback(async () => {
    if (!pendingJunction) return;
    const ordinalsEn = ['first', 'second', 'third', 'fourth'];
    const ordinalsEs = ['primera', 'segunda', 'tercera', 'cuarta'];
    const optionsText = pendingJunction.options
      .map((opt, i) => {
        const ordinal = speechLanguage === 'spanish' ? ordinalsEs[i] || `${i + 1}` : ordinalsEn[i] || `${i + 1}`;
        return speechLanguage === 'spanish'
          ? `Opción ${ordinal}: cable ${opt.wireLabel} hacia ${opt.description || opt.to}`
          : `Option ${ordinal}: wire ${opt.wireLabel} to ${opt.description || opt.to}`;
      })
      .join('. ');
    const question =
      speechLanguage === 'spanish'
        ? `El camino se divide aquí. ${optionsText}. Di el número del cable, o di primera o segunda.`
        : `The path splits here. ${optionsText}. Say the wire number, or say first or second.`;

    const canListen = voiceNextEnabled && ExpoSpeechRecognitionModule.isRecognitionAvailable();
    if (!canListen) {
      console.log('[Reader] Voice unavailable for junction prompt — defaulting to first option');
      if (pendingJunction.options[0]) void resolveJunctionChoice(pendingJunction.options[0]);
      return;
    }

    setVoiceStatus(speechLanguage === 'spanish' ? 'Pregunta de ruta...' : 'Path question...');
    await speakText(question, () => {
      startVoiceListening('junctionPrompt');
    });
  }, [pendingJunction, speechLanguage, voiceNextEnabled, resolveJunctionChoice, startVoiceListening]);

  const uncoveredWires = useMemo(() => {
    if (!completed || !schematicForHelp) return [];
    return getUncoveredWires(schematicForHelp.wires, steps);
  }, [completed, schematicForHelp, steps]);

  const handleContinueUncovered = useCallback(async () => {
    if (!schematicForHelp || uncoveredWires.length === 0) return;
    const nextLabel = uncoveredWires[0].label;
    const priorLength = steps.length;
    setContinuingUncovered(true);
    setVoiceStatus(speechLanguage === 'spanish' ? 'Generando pasos restantes...' : 'Generating remaining steps...');
    console.log('[Reader] Continuing with uncovered wire', { label: nextLabel, remaining: uncoveredWires.length });
    try {
      const dir: 'forward' | 'backward' = params.direction === 'backward' ? 'backward' : 'forward';
      const priorGenerationOrderSteps = schematicForHelp.readingSteps;
      const { steps: newSteps, pendingChoice } = await generateReadingSteps(
        {
          wires: schematicForHelp.wires,
          components: schematicForHelp.components,
          connections: schematicForHelp.connections,
          unknownSymbols: schematicForHelp.unknownSymbols,
          summary: '',
        },
        dir,
        nextLabel,
        schematicForHelp.branchChoices
      );

      const updatedGenerationOrderSteps = [...priorGenerationOrderSteps, ...newSteps];
      const updated: SchematicAnalysis = {
        ...schematicForHelp,
        readingSteps: updatedGenerationOrderSteps,
        pendingJunction: pendingChoice,
      };
      await saveSchematic(updated);
      setSchematicForHelp(updated);
      setPendingJunction(pendingChoice);

      const newDisplaySteps = dir === 'backward' ? [...newSteps].reverse() : newSteps;
      setSteps((prev) => {
        const appended = [...prev, ...newDisplaySteps];
        return appended.map((s, i) => ({ ...s, stepNumber: i + 1 }));
      });
      setCurrentIndex(priorLength);
      setCompleted(false);
    } catch (e) {
      console.error('[Reader] Failed to continue with uncovered wires', e);
      setVoiceError(
        speechLanguage === 'spanish' ? 'No se pudo continuar. Intenta de nuevo.' : 'Could not continue. Try again.'
      );
    } finally {
      setContinuingUncovered(false);
    }
  }, [schematicForHelp, uncoveredWires, steps.length, params.direction, speechLanguage]);

  const handleNext = useCallback(() => {
    stopVoiceListening();
    if (currentIndex >= steps.length - 1) {
      if (pendingJunction) {
        console.log('[Reader] Reached pending junction — asking by voice');
        void askJunctionQuestion();
        return;
      }
      console.log('[Reader] All steps complete');
      stopSpeech();
      setCompleted(true);
      return;
    }
    console.log('[Reader] Next step pressed', { from: currentIndex, to: currentIndex + 1 });
    setCurrentIndex((i) => i + 1);
  }, [currentIndex, steps.length, stopVoiceListening, pendingJunction, askJunctionQuestion]);

  const handlePrev = useCallback(() => {
    stopVoiceListening();
    if (currentIndex <= 0) return;
    console.log('[Reader] Previous step pressed', { from: currentIndex, to: currentIndex - 1 });
    setCurrentIndex((i) => i - 1);
  }, [currentIndex, stopVoiceListening]);

  const handleReread = useCallback(() => {
    stopVoiceListening();
    if (steps.length === 0) return;
    console.log('[Reader] Re-read button pressed', { step: currentIndex });
    const step = steps[currentIndex];
    let noteText: string | undefined;
    if (schematicForHelp) {
      const wire = step.wireLabel ? schematicForHelp.wires.find((w) => w.label === step.wireLabel) : undefined;
      const comp = step.componentLabel
        ? schematicForHelp.components.find((c) => c.label === step.componentLabel)
        : undefined;
      noteText = wire?.userNote || comp?.userNote;
    }
    const instructionText = getStepInstructionText(step, schematicForHelp, uiPrefs.readingStyle, speechLanguage === 'spanish');
    const spoken = noteText ? `${instructionText} ${noteText}` : instructionText;
    speakText(spoken, () => {
      console.log('[Reader] Speech done for step', currentIndex);
      startVoiceListening();
    });
  }, [currentIndex, schematicForHelp, speechLanguage, steps, startVoiceListening, stopVoiceListening, uiPrefs.readingStyle]);

  const handleHelpQuestion = useCallback(async (question: string) => {
    if (!schematicForHelp) {
      setVoiceError(
        speechLanguage === 'spanish'
          ? 'No hay contexto del esquema para ayuda de AI.'
          : 'Schematic context is unavailable for AI help.'
      );
      setVoiceStatus(
        speechLanguage === 'spanish'
          ? 'Ayuda no disponible. Di "siguiente" o toca el micro.'
          : 'Help unavailable. Say "next" or tap mic to continue.'
      );
      startVoiceListening('command');
      return;
    }

    setVoiceStatus('Getting AI help...');
    try {
      const answer = await answerSchematicQuestion(
        {
          wires: schematicForHelp.wires,
          components: schematicForHelp.components,
          connections: schematicForHelp.connections,
          unknownSymbols: schematicForHelp.unknownSymbols,
          summary: schematicForHelp.summary ?? '',
        },
        question
      );
      setVoiceStatus(`AI: ${answer}`);
      await speakText(answer, () => {
        startVoiceListening('command');
      });
    } catch (error) {
      console.error('[Reader] AI help request failed', error);
      setVoiceError(
        speechLanguage === 'spanish'
          ? 'La ayuda de AI falló. Di "ayuda" para reintentar.'
          : 'AI help failed. Say "help" to try again.'
      );
      setVoiceStatus(
        speechLanguage === 'spanish'
          ? 'La ayuda de AI falló. Di "ayuda" para reintentar.'
          : 'AI help failed. Say "help" to try again.'
      );
      startVoiceListening('command');
    }
  }, [schematicForHelp, speechLanguage, startVoiceListening]);

  useSpeechRecognitionEvent('result', (event) => {
    if (!waitingForVoiceRef.current) return;
    const transcript = parseTranscript(event);
    if (!transcript) return;
    setVoiceStatus(`Heard: "${transcript}"`);
    if (commandHandledRef.current) return;

    if (listeningModeRef.current === 'helpQuestion') {
      if (transcript.length < 4) return;
      commandHandledRef.current = true;
      stopVoiceListening();
      void handleHelpQuestion(transcript);
      return;
    }

    if (listeningModeRef.current === 'startPrompt') {
      if (transcript.length < 2) return;
      commandHandledRef.current = true;
      stopVoiceListening();
      void resolveStartPoint(transcript);
      return;
    }

    if (listeningModeRef.current === 'junctionPrompt') {
      if (!pendingJunction) return;
      const match = matchJunctionAnswer(transcript, pendingJunction);
      if (!match) return;
      commandHandledRef.current = true;
      stopVoiceListening();
      void resolveJunctionChoice(match);
      return;
    }

    const wantsNext =
      transcript.includes('next') ||
      transcript.includes('continue') ||
      transcript.includes('siguiente') ||
      transcript.includes('continuar');
    const wantsBack =
      transcript.includes('go back') ||
      transcript.includes('back') ||
      transcript.includes('previous') ||
      transcript.includes('regresa') ||
      transcript.includes('atras');
    const wantsRepeat =
      transcript.includes('repeat') ||
      transcript.includes('again') ||
      transcript.includes('repite') ||
      transcript.includes('otra vez');
    const wantsHelp = transcript.includes('help') || transcript.includes('ayuda');

    if (wantsNext) {
      commandHandledRef.current = true;
      handleNext();
    } else if (wantsBack) {
      commandHandledRef.current = true;
      handlePrev();
    } else if (wantsRepeat) {
      commandHandledRef.current = true;
      handleReread();
    } else if (wantsHelp) {
      commandHandledRef.current = true;
      stopVoiceListening();
      setVoiceStatus(
        speechLanguage === 'spanish'
          ? 'Ayuda solicitada. Haz tu pregunta después del mensaje.'
          : 'Help requested. Ask your question after the prompt.'
      );
      speakText(
        speechLanguage === 'spanish'
          ? 'Claro. ¿En qué necesitas ayuda?'
          : 'Sure. What do you need help with?',
        () => {
        startVoiceListening('helpQuestion');
        }
      );
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!waitingForVoiceRef.current) return;
    setVoiceError(event.message || 'Voice recognition failed.');
    setListeningForVoice(false);
    waitingForVoiceRef.current = false;
  });

  useSpeechRecognitionEvent('end', () => {
    if (!waitingForVoiceRef.current || commandHandledRef.current || !voiceNextEnabled) return;
    setListeningForVoice(false);
    if (listeningModeRef.current === 'helpQuestion') {
      setVoiceStatus(
        speechLanguage === 'spanish'
          ? 'No escuché tu pregunta. Di "ayuda" para intentar otra vez.'
          : 'I did not hear your help question. Say "help" to try again.'
      );
    } else {
      setVoiceStatus(
        speechLanguage === 'spanish'
          ? 'Tiempo de escucha agotado. Toca el micro o repite el comando.'
          : 'Listening timed out. Tap mic or say command again.'
      );
    }
  });

  // Ask by voice for a starting point once the schematic is ready
  useEffect(() => {
    if (!awaitingStartAnswer || !schematicForHelp) return;
    void askForStartPoint();
  }, [awaitingStartAnswer, schematicForHelp, askForStartPoint]);

  // Safety net: if generation stopped at a junction before any step was
  // produced (branch right at the start), ask immediately rather than
  // showing a blank screen.
  useEffect(() => {
    if (loading || awaitingStartAnswer || resolvingJunction) return;
    if (steps.length === 0 && pendingJunction) {
      console.log('[Reader] No steps yet but a junction is pending — asking immediately');
      void askJunctionQuestion();
    }
  }, [loading, awaitingStartAnswer, resolvingJunction, steps.length, pendingJunction, askJunctionQuestion]);

  // Speak current step when it changes
  useEffect(() => {
    if (steps.length === 0 || loading) return;
    const step = steps[currentIndex];
    if (!step) return;

    stopVoiceListening();
    setVoiceStatus('Reading step...');

    console.log('[Reader] Displaying step', { index: currentIndex, stepNumber: step.stepNumber });
    animateIn();

    const total = steps.length;
    Animated.timing(progressAnim, {
      toValue: (currentIndex + 1) / total,
      duration: 400,
      useNativeDriver: false,
    }).start();

    // Read the user's own voice note for this wire/component, if any, right
    // after the AI's instruction — it's context only the user knows.
    let noteText: string | undefined;
    if (schematicForHelp) {
      const wire = step.wireLabel ? schematicForHelp.wires.find((w) => w.label === step.wireLabel) : undefined;
      const comp = step.componentLabel
        ? schematicForHelp.components.find((c) => c.label === step.componentLabel)
        : undefined;
      noteText = wire?.userNote || comp?.userNote;
    }
    const instructionText = getStepInstructionText(step, schematicForHelp, uiPrefs.readingStyle, speechLanguage === 'spanish');
    const spoken = noteText ? `${instructionText} ${noteText}` : instructionText;

    speakText(spoken, () => {
      console.log('[Reader] Speech done for step', currentIndex);
      startVoiceListening();
    });
  }, [animateIn, currentIndex, loading, progressAnim, schematicForHelp, speechLanguage, startVoiceListening, steps, stopVoiceListening, uiPrefs.readingStyle]);

  const handleToggleVoiceNext = () => {
    const next = !voiceNextEnabled;
    setVoiceNextEnabled(next);
    if (!next) {
      stopVoiceListening();
      setVoiceStatus('Voice next is off');
    } else {
      setVoiceError(null);
      setVoiceStatus(speechLanguage === 'spanish' ? 'Di "siguiente" cuando estés listo' : 'Say "next" when ready');
      startVoiceListening('command');
    }
  };

  const handleBack = () => {
    console.log('[Reader] Back button pressed');
    stopVoiceListening();
    stopSpeech();
    router.back();
  };

  useEffect(() => () => {
    stopVoiceListening();
    stopSpeech();
  }, [stopVoiceListening]);

  // Swipe gesture
  const swipeGesture = Gesture.Pan()
    .runOnJS(true)
    .onEnd((e) => {
      if (e.translationX < -60) {
        console.log('[Reader] Swipe left — next step');
        handleNext();
      } else if (e.translationX > 60) {
        console.log('[Reader] Swipe right — previous step');
        handlePrev();
      }
    });

  if (loading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.loadingText}>{speechLanguage === 'spanish' ? 'Cargando pasos...' : 'Loading steps...'}</Text>
      </View>
    );
  }

  if (awaitingStartAnswer || (steps.length === 0 && pendingJunction) || resolvingJunction) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Mic size={32} color={listeningForVoice ? WT.green : WT.blue} />
        <Text style={styles.loadingText}>{voiceStatus}</Text>
        {voiceError ? <Text style={styles.voiceErrorText}>{voiceError}</Text> : null}
        {!listeningForVoice && !resolvingJunction && voiceNextEnabled && (
          <AnimatedPressable
            onPress={() => (awaitingStartAnswer ? askForStartPoint() : askJunctionQuestion())}
            style={styles.voiceRetryBtn}
            scaleValue={0.9}
          >
            <Mic size={18} color={WT.blue} />
          </AnimatedPressable>
        )}
      </View>
    );
  }

  if (completed) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.completedIcon}>
          <CheckCircle size={48} color={WT.green} />
        </View>
        <Text style={styles.completedTitle}>{speechLanguage === 'spanish' ? '¡Esquema completado!' : 'Schematic Complete!'}</Text>
        <Text style={styles.completedSub}>
          {steps.length}
          {speechLanguage === 'spanish' ? ' pasos leídos correctamente' : ' steps read successfully'}
        </Text>
        {uncoveredWires.length > 0 && (
          <View style={styles.uncoveredBox}>
            <Text style={styles.uncoveredTitle}>
              {speechLanguage === 'spanish'
                ? `${uncoveredWires.length} cable(s) no estaban en este camino`
                : `${uncoveredWires.length} wire(s) weren't on this path`}
            </Text>
            <Text style={styles.uncoveredList}>
              {uncoveredWires.map((w) => w.label).join(', ')}
            </Text>
            <AnimatedPressable
              onPress={handleContinueUncovered}
              style={[styles.doneBtn, styles.continueUncoveredBtn]}
              disabled={continuingUncovered}
            >
              <Text style={styles.doneBtnText}>
                {continuingUncovered
                  ? speechLanguage === 'spanish'
                    ? 'Generando...'
                    : 'Generating...'
                  : speechLanguage === 'spanish'
                  ? `Leer cable ${uncoveredWires[0].label}`
                  : `Read wire ${uncoveredWires[0].label}`}
              </Text>
            </AnimatedPressable>
            {voiceError ? <Text style={styles.voiceErrorText}>{voiceError}</Text> : null}
          </View>
        )}
        <AnimatedPressable onPress={handleBack} style={styles.doneBtn}>
          <Text style={styles.doneBtnText}>{speechLanguage === 'spanish' ? 'Listo' : 'Done'}</Text>
        </AnimatedPressable>
      </View>
    );
  }

  const step = steps[currentIndex];
  if (!step) return null;
  const stepWireColor = getStepWireColor(step, schematicForHelp);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const counterText = `${currentIndex + 1} of ${steps.length}`;
  const isLightMode = uiPrefs.visualMode === 'normalLight';
  const isHighContrast = uiPrefs.visualMode === 'highContrast';
  const isDark = uiPrefs.visualMode === 'dark';
  const isResidentialLayout = uiPrefs.layoutPreset === 'residential';
  const isCommercialLayout = uiPrefs.layoutPreset === 'commercial';

  return (
    <GestureDetector gesture={swipeGesture}>
      <View
        style={[
          styles.root,
          isLightMode && styles.rootLight,
          isHighContrast && styles.rootHighContrast,
          isDark && styles.rootDark,
          { paddingTop: insets.top },
        ]}
      >
        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>

        {/* Top bar */}
        <View style={styles.topBar}>
          <AnimatedPressable onPress={handleBack} style={styles.backBtn} scaleValue={0.9}>
            <ArrowLeft
              size={22}
              color={isLightMode ? stylesColors.lightSecondary : isDark ? stylesColors.darkSecondary : WT.textSecondary}
            />
          </AnimatedPressable>
          <View style={styles.topBarCenter}>
            <PulsingLogo size={16} />
            <Text style={[styles.counterText, isLightMode && styles.counterTextLight, isDark && styles.counterTextDark]}>
              {counterText}
            </Text>
          </View>
          <AnimatedPressable onPress={handleToggleVoiceNext} style={styles.autoBtn} scaleValue={0.9}>
            {voiceNextEnabled ? (
              <Mic size={20} color={listeningForVoice ? WT.green : WT.blue} />
            ) : (
              <MicOff
                size={20}
                color={isLightMode ? stylesColors.lightSecondary : isDark ? stylesColors.darkSecondary : WT.textSecondary}
              />
            )}
          </AnimatedPressable>
        </View>

        {/* Step content */}
        <Animated.View
          style={[
            styles.stepContent,
            { opacity: contentOpacity, transform: [{ translateY: contentTranslate }] },
          ]}
        >
          <View style={[styles.modeBadge, isLightMode && styles.modeBadgeLight, isHighContrast && styles.modeBadgeHighContrast, isDark && styles.modeBadgeDark]}>
            <Text style={[styles.modeBadgeText, isLightMode && styles.modeBadgeTextLight, isHighContrast && styles.modeBadgeTextHighContrast, isDark && styles.modeBadgeTextDark]}>
              {uiPrefs.layoutPreset.toUpperCase()} • {uiPrefs.visualMode === 'normalLight' ? 'NORMAL LIGHT' : uiPrefs.visualMode === 'highContrast' ? 'HIGH CONTRAST' : 'DARK'}
            </Text>
          </View>
          {step.wireLabel && (
            <Text
              style={[
                styles.wireLabel,
                isLightMode && styles.wireLabelLight,
                isHighContrast && styles.textHighContrast,
                isDark && styles.wireLabelDark,
                stepWireColor ? { color: stepWireColor } : null,
              ]}
            >
              {step.wireLabel}
            </Text>
          )}
          <Text style={[styles.instruction, isLightMode && styles.instructionLight, isHighContrast && styles.instructionHighContrast, isDark && styles.instructionDark]}>
            {getStepInstructionText(step, schematicForHelp, uiPrefs.readingStyle, speechLanguage === 'spanish')}
          </Text>
          {step.componentLabel && !isResidentialLayout && (
            <View style={[styles.componentBadge, isLightMode && styles.componentBadgeLight, isDark && styles.componentBadgeDark]}>
              <Text style={[styles.componentBadgeText, isLightMode && styles.componentBadgeTextLight, isDark && styles.componentBadgeTextDark]}>
                {step.componentLabel}
              </Text>
            </View>
          )}
          {(step.detail && !isResidentialLayout && uiPrefs.readingStyle === 'detailed') && (
            <Text style={[styles.detail, isLightMode && styles.detailLight, isDark && styles.detailDark]}>{step.detail}</Text>
          )}
          {step.specialInstruction && (isCommercialLayout || isDark) && uiPrefs.readingStyle === 'detailed' && (
            <View style={[styles.specialBox, isLightMode && styles.specialBoxLight, isDark && styles.specialBoxDark]}>
              <Text style={[styles.specialLabel, isDark && styles.specialLabelDark]}>
                {speechLanguage === 'spanish' ? 'Instrucción especial' : 'Special Instruction'}
              </Text>
              <Text style={[styles.specialText, isLightMode && styles.specialTextLight, isDark && styles.specialTextDark]}>
                {step.specialInstruction}
              </Text>
            </View>
          )}
          <View style={[styles.voiceStatusBox, isLightMode && styles.voiceStatusBoxLight, isDark && styles.voiceStatusBoxDark]}>
            <Text style={[styles.voiceStatusLabel, isDark && styles.voiceStatusLabelDark]}>
              {voiceNextEnabled ? (listeningForVoice ? 'VOICE READY' : 'VOICE WAIT') : 'VOICE OFF'}
            </Text>
            <Text style={[styles.voiceStatusText, isLightMode && styles.voiceStatusTextLight, isDark && styles.voiceStatusTextDark]}>{voiceStatus}</Text>
            {voiceError ? <Text style={styles.voiceErrorText}>{voiceError}</Text> : null}
          </View>
        </Animated.View>

        {/* Bottom controls */}
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.secondaryControls}>
            {!isResidentialLayout ? (
              <AnimatedPressable
                onPress={handlePrev}
                style={styles.prevBtn}
                disabled={currentIndex === 0}
                scaleValue={0.93}
              >
                <ChevronLeft size={20} color={currentIndex === 0 ? WT.textTertiary : WT.textSecondary} />
                <Text style={[styles.prevBtnText, currentIndex === 0 && { color: WT.textTertiary }]}>
                  {speechLanguage === 'spanish' ? 'Anterior' : 'Previous'}
                </Text>
              </AnimatedPressable>
            ) : (
              <View />
            )}

            <AnimatedPressable onPress={handleReread} style={styles.rereadBtn} scaleValue={0.9}>
              <Volume2 size={20} color={WT.textSecondary} />
            </AnimatedPressable>

            {voiceNextEnabled && (
              <AnimatedPressable onPress={startVoiceListening} style={styles.voiceRetryBtn} scaleValue={0.9}>
                <Mic size={18} color={WT.blue} />
              </AnimatedPressable>
            )}
          </View>

          <AnimatedPressable onPress={handleNext} style={styles.nextBtn} scaleValue={0.97}>
            <Text style={styles.nextBtnText}>
              {currentIndex >= steps.length - 1
                ? speechLanguage === 'spanish'
                  ? 'FINALIZAR'
                  : 'FINISH'
                : isResidentialLayout
                ? speechLanguage === 'spanish'
                  ? 'SIGUIENTE'
                  : 'NEXT'
                : isCommercialLayout
                ? speechLanguage === 'spanish'
                  ? 'SIGUIENTE PUNTO'
                  : 'NEXT CHECKPOINT'
                : speechLanguage === 'spanish'
                ? 'SIGUIENTE PASO'
                : 'NEXT STEP'}
            </Text>
          </AnimatedPressable>
        </View>
      </View>
    </GestureDetector>
  );
}

const stylesColors = {
  lightSecondary: '#4B5563',
  darkSecondary: '#80EEFF',
} as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  rootLight: {
    backgroundColor: '#F4F7FB',
  },
  rootHighContrast: {
    backgroundColor: '#000000',
  },
  rootDark: {
    backgroundColor: '#061A22',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
  loadingText: {
    fontSize: 16,
    color: WT.textSecondary,
  },
  progressTrack: {
    height: 3,
    backgroundColor: WT.bgCardAlt,
  },
  progressFill: {
    height: 3,
    backgroundColor: WT.blue,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  counterText: {
    fontSize: 14,
    fontWeight: '600',
    color: WT.textSecondary,
  },
  counterTextLight: {
    color: '#4B5563',
  },
  counterTextDark: {
    color: '#80EEFF',
  },
  autoBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepContent: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 32,
    gap: 20,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: WT.bgCardAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: WT.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modeBadgeLight: {
    backgroundColor: '#E8EEF6',
    borderColor: '#D3DCE8',
  },
  modeBadgeHighContrast: {
    borderColor: WT.yellow,
    backgroundColor: 'rgba(255,214,10,0.18)',
  },
  modeBadgeDark: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.18)',
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: WT.textSecondary,
    letterSpacing: 0.7,
  },
  modeBadgeTextHighContrast: {
    color: WT.yellow,
  },
  modeBadgeTextLight: {
    color: '#334155',
  },
  modeBadgeTextDark: {
    color: '#80EEFF',
  },
  wireLabel: {
    fontSize: 32,
    fontWeight: '800',
    color: WT.blue,
    letterSpacing: -0.5,
  },
  wireLabelLight: {
    color: '#0B66B8',
  },
  wireLabelDark: {
    color: '#00E5FF',
    textShadowColor: 'rgba(0, 229, 255, 0.35)',
    textShadowRadius: 4,
  },
  textHighContrast: {
    color: WT.yellow,
  },
  instruction: {
    fontSize: 22,
    fontWeight: '500',
    color: WT.textPrimary,
    lineHeight: 32,
  },
  instructionLight: {
    color: '#0F172A',
    fontWeight: '600',
  },
  instructionHighContrast: {
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  instructionDark: {
    color: '#D6F8FF',
    fontWeight: '700',
    fontSize: 24,
    lineHeight: 34,
  },
  componentBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,214,10,0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,0.25)',
  },
  componentBadgeLight: {
    backgroundColor: 'rgba(11,102,184,0.1)',
    borderColor: 'rgba(11,102,184,0.24)',
  },
  componentBadgeDark: {
    backgroundColor: 'rgba(0,229,255,0.14)',
    borderColor: 'rgba(0,229,255,0.35)',
  },
  componentBadgeText: {
    fontSize: 15,
    fontWeight: '700',
    color: WT.yellow,
  },
  componentBadgeTextLight: {
    color: '#0B66B8',
  },
  componentBadgeTextDark: {
    color: '#00E5FF',
  },
  detail: {
    fontSize: 15,
    color: WT.textSecondary,
    lineHeight: 22,
  },
  detailLight: {
    color: '#334155',
  },
  detailDark: {
    color: '#A3EDFF',
  },
  specialBox: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: WT.blue,
    gap: 4,
  },
  specialBoxLight: {
    backgroundColor: '#EAF3FF',
    borderLeftColor: '#0B66B8',
  },
  specialBoxDark: {
    backgroundColor: '#0D2A35',
    borderLeftColor: '#00E5FF',
  },
  specialLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  specialText: {
    fontSize: 14,
    color: WT.textSecondary,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  specialLabelDark: {
    color: '#00E5FF',
  },
  specialTextLight: {
    color: '#334155',
  },
  specialTextDark: {
    color: '#C3F6FF',
  },
  voiceStatusBox: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 4,
  },
  voiceStatusBoxLight: {
    backgroundColor: '#EAF1FA',
    borderColor: '#D3DCE8',
  },
  voiceStatusBoxDark: {
    backgroundColor: '#0E2A35',
    borderColor: '#00E5FF',
  },
  voiceStatusLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  voiceStatusLabelDark: {
    color: '#00E5FF',
  },
  voiceStatusText: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 19,
  },
  voiceStatusTextLight: {
    color: '#334155',
  },
  voiceStatusTextDark: {
    color: '#B7F4FF',
  },
  voiceErrorText: {
    fontSize: 12,
    color: WT.red,
  },
  bottomControls: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: WT.border,
  },
  secondaryControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prevBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
  },
  prevBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: WT.textSecondary,
  },
  rereadBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: WT.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: WT.border,
  },
  voiceRetryBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: WT.blueMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: WT.blue,
  },
  nextBtn: {
    backgroundColor: WT.blue,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: 'center',
  },
  nextBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  completedIcon: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: WT.greenMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: WT.textPrimary,
    letterSpacing: -0.3,
  },
  completedSub: {
    fontSize: 16,
    color: WT.textSecondary,
  },
  uncoveredBox: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: WT.yellow,
    gap: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  uncoveredTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: WT.yellow,
    textAlign: 'center',
  },
  uncoveredList: {
    fontSize: 13,
    color: WT.textSecondary,
    textAlign: 'center',
  },
  doneBtn: {
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginTop: 8,
  },
  continueUncoveredBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 2,
  },
  doneBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
