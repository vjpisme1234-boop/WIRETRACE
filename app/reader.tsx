import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
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
import { getSchematic, ReadingStep } from '@/utils/schematic-storage';
import { speakText, stopSpeech } from '@/utils/tts';
import { DEFAULT_UI_PREFERENCES, loadUIPreferences } from '@/utils/ui-preferences';

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

  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(20)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const waitingForVoiceRef = useRef(false);
  const commandHandledRef = useRef(false);

  const animateIn = useCallback(() => {
    contentOpacity.setValue(0);
    contentTranslate.setValue(20);
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(contentTranslate, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    const load = async () => {
      console.log('[Reader] Loading schematic', { id: params.schematicId });
      const schematic = await getSchematic(params.schematicId);
      if (!schematic) {
        console.error('[Reader] Schematic not found');
        router.back();
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
  }, []);

  useEffect(() => {
    loadUIPreferences().then(setUiPrefs);
  }, []);

  const stopVoiceListening = useCallback(() => {
    waitingForVoiceRef.current = false;
    setListeningForVoice(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // no-op
    }
  }, []);

  const startVoiceListening = useCallback(async () => {
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
    setVoiceStatus('Listening... say "next"');
    setListeningForVoice(true);
    waitingForVoiceRef.current = true;
    commandHandledRef.current = false;
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
      contextualStrings: ['next', 'go next', 'continue', 'previous', 'back', 'repeat'],
    });
  }, [voiceNextEnabled]);

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

  useSpeechRecognitionEvent('result', (event) => {
    if (!waitingForVoiceRef.current) return;
    const transcript = event.results?.[0]?.transcript?.toLowerCase?.() || '';
    if (!transcript) return;
    setVoiceStatus(`Heard: "${transcript}"`);
    if (commandHandledRef.current) return;

    if (transcript.includes('next') || transcript.includes('continue')) {
      commandHandledRef.current = true;
      handleNext();
    } else if (transcript.includes('back') || transcript.includes('previous')) {
      commandHandledRef.current = true;
      handlePrev();
    } else if (transcript.includes('repeat') || transcript.includes('again')) {
      commandHandledRef.current = true;
      handleReread();
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
    setVoiceStatus('Listening timed out. Tap mic to retry.');
  });

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
      setVoiceStatus('Say "next" when ready');
      startVoiceListening();
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
        <Text style={styles.loadingText}>Loading steps...</Text>
      </View>
    );
  }

  if (completed) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.completedIcon}>
          <CheckCircle size={48} color={WT.green} />
        </View>
        <Text style={styles.completedTitle}>Schematic Complete!</Text>
        <Text style={styles.completedSub}>
          {steps.length}
          {' steps read successfully'}
        </Text>
        <AnimatedPressable onPress={handleBack} style={styles.doneBtn}>
          <Text style={styles.doneBtnText}>Done</Text>
        </AnimatedPressable>
      </View>
    );
  }

  const step = steps[currentIndex];
  if (!step) return null;

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const counterText = `${currentIndex + 1} of ${steps.length}`;
  const isHighContrast = uiPrefs.visualMode === 'highContrast';
  const isDetailedSymbols = uiPrefs.visualMode === 'detailedSymbols';
  const isResidentialLayout = uiPrefs.layoutPreset === 'residential';
  const isCommercialLayout = uiPrefs.layoutPreset === 'commercial';

  return (
    <GestureDetector gesture={swipeGesture}>
      <View style={[styles.root, isHighContrast && styles.rootHighContrast, { paddingTop: insets.top }]}>
        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>

        {/* Top bar */}
        <View style={styles.topBar}>
          <AnimatedPressable onPress={handleBack} style={styles.backBtn} scaleValue={0.9}>
            <ArrowLeft size={22} color={WT.textSecondary} />
          </AnimatedPressable>
          <Text style={styles.counterText}>{counterText}</Text>
          <AnimatedPressable onPress={handleToggleVoiceNext} style={styles.autoBtn} scaleValue={0.9}>
            {voiceNextEnabled ? (
              <Mic size={20} color={listeningForVoice ? WT.green : WT.blue} />
            ) : (
              <MicOff size={20} color={WT.textSecondary} />
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
          <View style={[styles.modeBadge, isHighContrast && styles.modeBadgeHighContrast]}>
            <Text style={[styles.modeBadgeText, isHighContrast && styles.modeBadgeTextHighContrast]}>
              {uiPrefs.layoutPreset.toUpperCase()} • {uiPrefs.visualMode === 'normalLight' ? 'NORMAL LIGHT' : uiPrefs.visualMode === 'highContrast' ? 'HIGH CONTRAST' : 'DETAILED SYMBOLS'}
            </Text>
          </View>
          {step.wireLabel && (
            <Text style={[styles.wireLabel, isHighContrast && styles.textHighContrast]}>{step.wireLabel}</Text>
          )}
          <Text style={[styles.instruction, isHighContrast && styles.instructionHighContrast]}>{step.instruction}</Text>
          {step.componentLabel && !isResidentialLayout && (
            <View style={styles.componentBadge}>
              <Text style={styles.componentBadgeText}>{step.componentLabel}</Text>
            </View>
          )}
          {(step.detail && !isResidentialLayout) && (
            <Text style={styles.detail}>{step.detail}</Text>
          )}
          {step.specialInstruction && (isCommercialLayout || isDetailedSymbols) && (
            <View style={styles.specialBox}>
              <Text style={styles.specialLabel}>Special Instruction</Text>
              <Text style={styles.specialText}>{step.specialInstruction}</Text>
            </View>
          )}
          <View style={styles.voiceStatusBox}>
            <Text style={styles.voiceStatusLabel}>
              {voiceNextEnabled ? (listeningForVoice ? 'VOICE READY' : 'VOICE WAIT') : 'VOICE OFF'}
            </Text>
            <Text style={styles.voiceStatusText}>{voiceStatus}</Text>
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
                  Previous
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
              {currentIndex >= steps.length - 1 ? 'FINISH' : isResidentialLayout ? 'NEXT' : isCommercialLayout ? 'NEXT CHECKPOINT' : 'NEXT STEP'}
            </Text>
          </AnimatedPressable>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  rootHighContrast: {
    backgroundColor: '#000000',
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
  modeBadgeHighContrast: {
    borderColor: WT.yellow,
    backgroundColor: 'rgba(255,214,10,0.18)',
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
  wireLabel: {
    fontSize: 32,
    fontWeight: '800',
    color: WT.blue,
    letterSpacing: -0.5,
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
  instructionHighContrast: {
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '700',
    color: '#FFFFFF',
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
  componentBadgeText: {
    fontSize: 15,
    fontWeight: '700',
    color: WT.yellow,
  },
  detail: {
    fontSize: 15,
    color: WT.textSecondary,
    lineHeight: 22,
  },
  specialBox: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: WT.blue,
    gap: 4,
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
  voiceStatusBox: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 4,
  },
  voiceStatusLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  voiceStatusText: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 19,
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
