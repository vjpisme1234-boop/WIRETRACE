import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle, X } from 'lucide-react-native';
import { WT, SYMBOL_TYPES } from '@/constants/wiretrace';
import { getSchematic, updateSchematic } from '@/utils/schematic-storage';
import { getSymbolClarification } from '@/utils/openrouter';

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
    <Animated.View style={[{ transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} disabled={disabled} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default function IdentifySymbolScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ schematicId: string; symbolId: string; imageUri?: string }>();

  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [clarification, setClarification] = useState<string | null>(null);
  const [loadingClarification, setLoadingClarification] = useState(false);
  const [saving, setSaving] = useState(false);
  const [symbolDesc, setSymbolDesc] = useState('');

  useEffect(() => {
    const load = async () => {
      console.log('[IdentifySymbol] Loading symbol', { schematicId: params.schematicId, symbolId: params.symbolId });
      const schematic = await getSchematic(params.schematicId);
      const sym = schematic?.unknownSymbols.find((u) => u.id === params.symbolId);
      if (sym) setSymbolDesc(sym.description);
    };
    load();
  }, []);

  const handleSelectType = async (type: string) => {
    console.log('[IdentifySymbol] Symbol type selected', { type });
    setSelected(type);
    setCustomText('');
    setClarification(null);
    setLoadingClarification(true);
    try {
      const text = await getSymbolClarification(type);
      setClarification(text);
    } catch (e) {
      console.error('[IdentifySymbol] Clarification fetch failed', e);
    } finally {
      setLoadingClarification(false);
    }
  };

  const handleConfirm = async () => {
    const identification = selected || customText.trim();
    if (!identification) return;

    console.log('[IdentifySymbol] Confirm pressed', { identification });
    setSaving(true);
    try {
      const schematic = await getSchematic(params.schematicId);
      if (!schematic) throw new Error('Schematic not found');

      const updatedSymbols = schematic.unknownSymbols.map((u) =>
        u.id === params.symbolId ? { ...u, userIdentifiedAs: identification } : u
      );
      const updatedComponents = schematic.components.map((c) =>
        c.isUnknown && !c.userIdentifiedAs ? { ...c, userIdentifiedAs: identification } : c
      );

      await updateSchematic(params.schematicId, {
        unknownSymbols: updatedSymbols,
        components: updatedComponents,
      });

      console.log('[IdentifySymbol] Symbol identified and saved', { identification });
      router.back();
    } catch (e) {
      console.error('[IdentifySymbol] Save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = () => {
    console.log('[IdentifySymbol] Dismiss pressed');
    router.back();
  };

  const confirmLabel = selected || customText.trim();

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      {/* Handle + header */}
      <View style={styles.sheetHandle} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>What is this symbol?</Text>
        <AnimatedPressable onPress={handleDismiss} style={styles.closeBtn} scaleValue={0.9}>
          <X size={20} color={WT.textSecondary} />
        </AnimatedPressable>
      </View>

      {symbolDesc ? (
        <View style={styles.descBanner}>
          {params.imageUri ? (
            <View style={styles.imageRow}>
              <Image
                source={{ uri: params.imageUri }}
                style={styles.symbolThumb}
                resizeMode="contain"
              />
              <Text style={[styles.descText, { flex: 1 }]}>{symbolDesc}</Text>
            </View>
          ) : (
            <Text style={styles.descText}>{symbolDesc}</Text>
          )}
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick select grid */}
        <Text style={styles.sectionLabel}>Common Symbols</Text>
        <View style={styles.grid}>
          {SYMBOL_TYPES.map((type) => {
            const isActive = selected === type;
            return (
              <AnimatedPressable
                key={type}
                onPress={() => handleSelectType(type)}
                style={[styles.gridItem, isActive && styles.gridItemActive]}
                scaleValue={0.93}
              >
                {isActive && (
                  <CheckCircle size={12} color={WT.blue} style={styles.gridCheck} />
                )}
                <Text style={[styles.gridItemText, isActive && styles.gridItemTextActive]}>
                  {type}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>

        {/* Custom input */}
        <Text style={styles.sectionLabel}>Other (type it)</Text>
        <TextInput
          style={[styles.customInput, customText && styles.customInputFilled]}
          placeholder="e.g. Pressure sensor, VFD drive..."
          placeholderTextColor={WT.textTertiary}
          value={customText}
          onChangeText={(t) => {
            setCustomText(t);
            if (t) setSelected(null);
          }}
          returnKeyType="done"
        />

        {/* Clarification */}
        {loadingClarification && (
          <View style={styles.clarificationBox}>
            <Text style={styles.clarificationLoading}>Getting technical details...</Text>
          </View>
        )}
        {clarification && !loadingClarification && (
          <View style={styles.clarificationBox}>
            <Text style={styles.clarificationLabel}>Technical Note</Text>
            <Text style={styles.clarificationText}>{clarification}</Text>
          </View>
        )}
      </ScrollView>

      {/* Confirm button */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <AnimatedPressable
          onPress={handleConfirm}
          style={[styles.confirmBtn, !confirmLabel && styles.confirmBtnDisabled]}
          disabled={!confirmLabel || saving}
          scaleValue={0.97}
        >
          <Text style={styles.confirmBtnText}>
            {saving ? 'Saving...' : confirmLabel ? `Confirm: ${confirmLabel}` : 'Select a symbol type'}
          </Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: WT.textTertiary,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: WT.bgCardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  descBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: WT.bgCard,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: WT.border,
  },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  symbolThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: WT.bgCardAlt,
    borderWidth: 1,
    borderColor: WT.border,
  },
  descText: {
    fontSize: 13,
    color: WT.textSecondary,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItem: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gridItemActive: {
    backgroundColor: WT.blueMuted,
    borderColor: WT.blue,
  },
  gridCheck: {
    // positioned inline
  },
  gridItemText: {
    fontSize: 13,
    fontWeight: '500',
    color: WT.textSecondary,
  },
  gridItemTextActive: {
    color: WT.blue,
    fontWeight: '600',
  },
  customInput: {
    backgroundColor: WT.bgInput,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: WT.textPrimary,
    borderWidth: 1,
    borderColor: WT.border,
  },
  customInputFilled: {
    borderColor: WT.blue,
  },
  clarificationBox: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: WT.blue,
    gap: 4,
  },
  clarificationLoading: {
    fontSize: 13,
    color: WT.textTertiary,
    fontStyle: 'italic',
  },
  clarificationLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  clarificationText: {
    fontSize: 14,
    color: WT.textSecondary,
    lineHeight: 20,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: WT.border,
    backgroundColor: WT.bg,
  },
  confirmBtn: {
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: WT.bgCardAlt,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
