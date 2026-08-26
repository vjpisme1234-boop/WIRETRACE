import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GraduationCap } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { SYMBOL_CATEGORIES, SymbolEntry } from '@/app/symbol-dictionary';

// Something to read while the AI works, drawn from the symbol dictionary the
// app already ships so there is no second body of content to maintain and it
// is bilingual for free.
//
// This exists to make an ordinary wait pass more pleasantly. It is deliberately
// not a substitute for the slow-scan notice: a card that keeps cheerfully
// cycling makes a dead request look busy, which is why the notice sits above it
// and says the honest thing.

const ROTATE_EVERY_MS = 14_000;

function flattenSymbols(): SymbolEntry[] {
  return SYMBOL_CATEGORIES.flatMap((category) => category.symbols);
}

interface Props {
  es: boolean;
}

export default function ScanFlashcard({ es }: Props) {
  const symbols = useMemo(flattenSymbols, []);
  const [index, setIndex] = useState(() => Math.floor(Math.random() * Math.max(symbols.length, 1)));
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (symbols.length < 2) return;
    const timer = setInterval(() => {
      // Step by a random stride so a long wait does not walk the list in
      // order, which would give away that it is a fixed list.
      setIndex((i) => (i + 1 + Math.floor(Math.random() * 3)) % symbols.length);
      setRevealed(false);
    }, ROTATE_EVERY_MS);
    return () => clearInterval(timer);
  }, [symbols.length]);

  const reveal = useCallback(() => setRevealed((r) => !r), []);

  if (symbols.length === 0) return null;
  const symbol = symbols[index % symbols.length];
  const label = es ? symbol.labelEs : symbol.label;
  const description = es ? symbol.descriptionEs : symbol.description;
  const wiring = es ? symbol.wiringEs : symbol.wiring;

  return (
    <Pressable onPress={reveal} style={styles.card} accessibilityRole="button">
      <View style={styles.header}>
        <GraduationCap size={14} color={WT.blueMuted} />
        <Text style={styles.headerText}>
          {es ? 'Mientras esperas' : 'While you wait'}
        </Text>
      </View>

      <Text style={styles.label}>{label}</Text>
      {symbol.code ? <Text style={styles.code}>{symbol.code}</Text> : null}

      {revealed ? (
        <View style={styles.revealBlock}>
          <Text style={styles.description}>{description}</Text>
          {wiring ? <Text style={styles.wiring}>{wiring}</Text> : null}
        </View>
      ) : (
        <Text style={styles.prompt}>
          {es ? 'Toca para ver qué hace' : 'Tap to see what it does'}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: WT.bgCardAlt,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 4,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  headerText: {
    color: WT.blueMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  label: { color: WT.textPrimary, fontSize: 15, fontWeight: '700' },
  code: { color: WT.textTertiary, fontSize: 12, fontFamily: 'monospace' },
  prompt: { color: WT.textTertiary, fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  revealBlock: { marginTop: 6, gap: 6 },
  description: { color: WT.textSecondary, fontSize: 13, lineHeight: 18 },
  wiring: { color: WT.yellowMuted, fontSize: 12, lineHeight: 17 },
});
