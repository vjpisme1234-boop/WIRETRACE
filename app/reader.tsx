import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { getSchematic, ReadingStep, SchematicAnalysis } from '@/utils/schematic-storage';
import { answerSchematicQuestion } from '@/utils/openrouter';
import { loadTTSSettings, speakText, stopSpeech } from '@/utils/tts';
import { DEFAULT_UI_PREFERENCES, loadUIPreferences } from '@/utils/ui-preferences';

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
  const params = useLocalSearchParams<{ schematicId: string; direction: string; startLabel: string }>();

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

  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(20)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const waitingForVoiceRef = useRef(false);
  const commandHandledRef = useRef(false);
  const listeningModeRef = useRef<'command' | 'helpQuestion'>('command');

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

      let stepsToUse = schematic.readingSteps;
      if (params.direction === 'backward') {
        stepsToUse = [...stepsToUse].reverse().map((s, i) => ({ ...s, stepNumber: i + 1 }));
      }

      setSteps(stepsToUse);
      setLoading(false);
      console.log('[Reader] Steps loaded', { count: stepsToUse.length });
    };
    load();
  }, [params.direction, params.schematicId]);

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

  const startVoiceListening = useCallback(async (mode: 'command' | 'helpQuestion' = 'command') => {
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
        : speechLanguage === 'spanish'
        ? 'Escuchando... dime qué necesitas'
        : 'Listening... tell me what you need help with'
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
        speechLanguage === 'spanish'
          ? ['siguiente', 'continuar', 'regresa', 'atras', 'repite', 'ayuda']
          : ['next', 'go next', 'continue', 'go back', 'previous', 'back', 'repeat', 'help'],
    });
  }, [voiceNextEnabled, speechLanguage]);

  const parseTranscript = (event: any): string => {
    const rawResults = Array.isArray(event?.results) ? event.results : [];
    for (let i = rawResults.length - 1; i >= 0; i -= 1) {
      const text = rawResults[i]?.transcript;
      if (typeof text === 'string' && text.trim()) return text.trim().toLowerCase();
    }
    return '';
  };

  const handleNext = useCallback(() => {
    stopVoiceListening();
    if (currentIndex >= steps.length - 1) {
      console.log('[Reader] All steps complete');
      stopSpeech();
      setCompleted(true);
      return;
    }
    console.log('[Reader] Next step pressed', { from: currentIndex, to: currentIndex + 1 });
    setCurrentIndex((i) => i + 1);
  }, [currentIndex, steps.length, stopVoiceListening]);

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
    speakText(step.instruction, () => {
      console.log('[Reader] Speech done for step', currentIndex);
      startVoiceListening();
    });
  }, [currentIndex, steps, startVoiceListening, stopVoiceListening]);

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
  }, [speechLanguage, voiceNextEnabled]);

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

    speakText(step.instruction, () => {
      console.log('[Reader] Speech done for step', currentIndex);
      startVoiceListening();
    });
  }, [animateIn, currentIndex, loading, progressAnim, startVoiceListening, steps, stopVoiceListening]);

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
          <Text style={[styles.counterText, isLightMode && styles.counterTextLight, isDark && styles.counterTextDark]}>
            {counterText}
          </Text>
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
            {step.instruction}
          </Text>
          {step.componentLabel && !isResidentialLayout && (
            <View style={[styles.componentBadge, isLightMode && styles.componentBadgeLight, isDark && styles.componentBadgeDark]}>
              <Text style={[styles.componentBadgeText, isLightMode && styles.componentBadgeTextLight, isDark && styles.componentBadgeTextDark]}>
                {step.componentLabel}
              </Text>
            </View>
          )}
          {(step.detail && !isResidentialLayout) && (
            <Text style={[styles.detail, isLightMode && styles.detailLight, isDark && styles.detailDark]}>{step.detail}</Text>
          )}
          {step.specialInstruction && (isCommercialLayout || isDark) && (
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
  doneBtn: {
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 48,
    marginTop: 8,
  },
  doneBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
