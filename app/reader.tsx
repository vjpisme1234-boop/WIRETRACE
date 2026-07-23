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
  Pause,
  Play,
  Volume2,
} from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { getSchematic, ReadingStep } from '@/utils/schematic-storage';
import { speakText, stopSpeech, loadTTSSettings, getAutoAdvanceMs } from '@/utils/tts';

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
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [autoAdvanceMs, setAutoAdvanceMs] = useState<number | null>(null);

  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(20)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      const settings = await loadTTSSettings();
      const ms = getAutoAdvanceMs(settings.autoAdvanceDelay);
      setAutoAdvanceMs(ms);

      setSteps(stepsToUse);
      setLoading(false);
      console.log('[Reader] Steps loaded', { count: stepsToUse.length });
    };
    load();
  }, []);

  // Speak current step when it changes
  useEffect(() => {
    if (steps.length === 0 || loading) return;
    const step = steps[currentIndex];
    if (!step) return;

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
      if (autoAdvance && autoAdvanceMs) {
        autoTimer.current = setTimeout(() => {
          handleNext();
        }, autoAdvanceMs);
      }
    });

    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [currentIndex, steps, loading]);

  const handleNext = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    if (currentIndex >= steps.length - 1) {
      console.log('[Reader] All steps complete');
      stopSpeech();
      setCompleted(true);
      return;
    }
    console.log('[Reader] Next step pressed', { from: currentIndex, to: currentIndex + 1 });
    setCurrentIndex((i) => i + 1);
  }, [currentIndex, steps.length]);

  const handlePrev = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    if (currentIndex <= 0) return;
    console.log('[Reader] Previous step pressed', { from: currentIndex, to: currentIndex - 1 });
    setCurrentIndex((i) => i - 1);
  }, [currentIndex]);

  const handleReread = () => {
    if (steps.length === 0) return;
    console.log('[Reader] Re-read button pressed', { step: currentIndex });
    const step = steps[currentIndex];
    speakText(step.instruction);
  };

  const handleToggleAutoAdvance = () => {
    const next = !autoAdvance;
    console.log('[Reader] Auto-advance toggled', { autoAdvance: next });
    setAutoAdvance(next);
    if (!next && autoTimer.current) clearTimeout(autoTimer.current);
  };

  const handleBack = () => {
    console.log('[Reader] Back button pressed');
    stopSpeech();
    router.back();
  };

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

  return (
    <GestureDetector gesture={swipeGesture}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
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
          <AnimatedPressable onPress={handleToggleAutoAdvance} style={styles.autoBtn} scaleValue={0.9}>
            {autoAdvance ? (
              <Pause size={20} color={WT.blue} />
            ) : (
              <Play size={20} color={WT.textSecondary} />
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
          {step.wireLabel && (
            <Text style={styles.wireLabel}>{step.wireLabel}</Text>
          )}
          <Text style={styles.instruction}>{step.instruction}</Text>
          {step.componentLabel && (
            <View style={styles.componentBadge}>
              <Text style={styles.componentBadgeText}>{step.componentLabel}</Text>
            </View>
          )}
          {step.detail && (
            <Text style={styles.detail}>{step.detail}</Text>
          )}
          {step.specialInstruction && (
            <View style={styles.specialBox}>
              <Text style={styles.specialLabel}>Special Instruction</Text>
              <Text style={styles.specialText}>{step.specialInstruction}</Text>
            </View>
          )}
        </Animated.View>

        {/* Bottom controls */}
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.secondaryControls}>
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

            <AnimatedPressable onPress={handleReread} style={styles.rereadBtn} scaleValue={0.9}>
              <Volume2 size={20} color={WT.textSecondary} />
            </AnimatedPressable>
          </View>

          <AnimatedPressable onPress={handleNext} style={styles.nextBtn} scaleValue={0.97}>
            <Text style={styles.nextBtnText}>
              {currentIndex >= steps.length - 1 ? 'FINISH' : 'NEXT STEP'}
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
  wireLabel: {
    fontSize: 32,
    fontWeight: '800',
    color: WT.blue,
    letterSpacing: -0.5,
  },
  instruction: {
    fontSize: 22,
    fontWeight: '500',
    color: WT.textPrimary,
    lineHeight: 32,
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
