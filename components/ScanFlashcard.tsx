import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { SCAN_FACTS } from '@/constants/scan-facts';

// Something to read while the AI works.
//
// This exists to make an ordinary wait pass more pleasantly. It is deliberately
// not a substitute for the slow-scan notice: a card that keeps cheerfully
// cycling makes a dead request look busy, which is why the notice sits above it
// and says the honest thing.

const ROTATE_EVERY_MS = 14_000;
const PULSE_MS = 1600;

// Shuffled per scan so a repeat scan does not open on the same fact, and so
// the order is not obviously a fixed list on a long wait.
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface Props {
  es: boolean;
}

export default function ScanFlashcard({ es }: Props) {
  const facts = useMemo(() => shuffled(SCAN_FACTS), []);
  const [index, setIndex] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % facts.length);
  }, [facts.length]);

  // Thick blue edge that breathes, so the card reads as alive rather than as
  // another static panel on a screen that is already mostly waiting.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (facts.length < 2) return;
    const timer = setInterval(next, ROTATE_EVERY_MS);
    return () => clearInterval(timer);
  }, [facts.length, next]);

  if (facts.length === 0) return null;

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [WT.blueDim, WT.blue],
  });

  return (
    <Animated.View style={[styles.card, { borderColor }]}>
      <Pressable onPress={next} accessibilityRole="button" style={styles.pressable}>
        <Animated.View style={styles.header}>
          <Sparkles size={14} color={WT.pink} />
          <Text style={styles.headerText}>
            {es ? 'Mientras esperas' : 'While you wait'}
          </Text>
        </Animated.View>

        <Text style={styles.fact}>{es ? facts[index].es : facts[index].en}</Text>

        <Text style={styles.prompt}>
          {es ? 'Toca para otro dato' : 'Tap for another'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: WT.bgCardAlt,
    borderWidth: 4,
  },
  pressable: { padding: 16, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerText: {
    color: WT.pink,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fact: {
    color: WT.pinkBright,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  prompt: {
    color: WT.pinkMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
});
