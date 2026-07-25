import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { BookOpen, Camera, CircuitBoard, Clock, Settings, Zap } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { loadSchematics, SchematicAnalysis } from '@/utils/schematic-storage';

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

function SchematicCard({ item, index }: { item: SchematicAnalysis; index: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 70, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 70, useNativeDriver: true }),
    ]).start();
  }, []);

  const dateDisplay = new Date(item.analyzedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const handlePress = () => {
    console.log('[Home] Tapped recent schematic', { id: item.id, name: item.name });
    router.push({ pathname: '/analyze', params: { schematicId: item.id } });
  };

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AnimatedPressable onPress={handlePress} style={styles.card}>
        <View style={styles.cardThumb}>
          {item.imageUri ? (
            <Image
              source={resolveImageSource(item.imageUri)}
              style={styles.thumbImage}
              resizeMode="cover"
            />
          ) : (
            <CircuitBoard size={28} color={WT.blue} />
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.cardMeta}>
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>
                {item.wireCount}
              </Text>
              <Text style={styles.metaBadgeLabel}>
                {' wires'}
              </Text>
            </View>
            <View style={styles.metaDot} />
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>
                {item.componentCount}
              </Text>
              <Text style={styles.metaBadgeLabel}>
                {' parts'}
              </Text>
            </View>
          </View>
          <View style={styles.cardTime}>
            <Clock size={11} color={WT.textTertiary} />
            <Text style={styles.cardTimeText}>
              {dateDisplay}
            </Text>
          </View>
        </View>
        <View style={styles.cardChevron}>
          <Text style={styles.chevronText}>›</Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [schematics, setSchematics] = useState<SchematicAnalysis[]>([]);
  const scanScale = useRef(new Animated.Value(1)).current;

  useFocusEffect(
    useCallback(() => {
      console.log('[Home] Screen focused — loading schematics');
      loadSchematics().then(setSchematics).catch(console.error);
    }, [])
  );

  // Pulse animation for scan button
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scanScale, { toValue: 1.03, duration: 1200, useNativeDriver: true }),
        Animated.timing(scanScale, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const handleScan = () => {
    console.log('[Home] Tapped Scan Schematic button');
    router.push('/camera');
  };

  const handleSettings = () => {
    console.log('[Home] Tapped Settings button');
    router.push('/settings');
  };

  const handleDictionary = () => {
    console.log('[Home] Tapped Symbol Dictionary');
    router.push('/symbol-dictionary');
  };

  const topPad = insets.top + 16;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.headerLeft}>
          <Zap size={22} color={WT.blue} fill={WT.blue} />
          <Text style={styles.headerTitle}>WireTrace AI</Text>
        </View>
        <AnimatedPressable onPress={handleSettings} style={styles.settingsBtn} scaleValue={0.9}>
          <Settings size={22} color={WT.textSecondary} />
        </AnimatedPressable>
      </View>

      <FlatList
        data={schematics}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
        ListHeaderComponent={
          <>
            {/* Hero section */}
            <View style={styles.heroSection}>
              <Animated.View style={{ transform: [{ scale: scanScale }] }}>
                <AnimatedPressable onPress={handleScan} style={styles.scanButton} scaleValue={0.96}>
                  <View style={styles.scanButtonInner}>
                    <Camera size={32} color="#FFFFFF" strokeWidth={2} />
                    <Text style={styles.scanButtonText}>Scan Schematic</Text>
                    <Text style={styles.scanButtonSub}>Point camera at a wire diagram</Text>
                  </View>
                </AnimatedPressable>
              </Animated.View>

              {/* Symbol Dictionary quick-access */}
              <AnimatedPressable onPress={handleDictionary} style={styles.dictBtn} scaleValue={0.97}>
                <BookOpen size={18} color={WT.blue} />
                <Text style={styles.dictBtnText}>Symbol Dictionary</Text>
                <Text style={styles.dictBtnSub}>Reference guide for all standard symbols</Text>
              </AnimatedPressable>
            </View>

            {/* Section header */}
            {schematics.length > 0 && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent Schematics</Text>
                <Text style={styles.sectionCount}>
                  {schematics.length}
                </Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <CircuitBoard size={36} color={WT.blue} />
            </View>
            <Text style={styles.emptyTitle}>No schematics yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap Scan to photograph a wire diagram and get started
            </Text>
          </View>
        }
        renderItem={({ item, index }) => <SchematicCard item={item} index={index} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.footerText}>Powered by AI Vision</Text>
      </View>
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
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: WT.textPrimary,
    letterSpacing: -0.3,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
  },
  heroSection: {
    paddingTop: 28,
    paddingBottom: 32,
  },
  scanButton: {
    backgroundColor: WT.blue,
    borderRadius: 20,
    overflow: 'hidden',
  },
  scanButtonInner: {
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  scanButtonText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  scanButtonSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '400',
  },
  dictBtn: {
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: WT.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dictBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: WT.textPrimary,
    flex: 1,
  },
  dictBtnSub: {
    fontSize: 12,
    color: WT.textSecondary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  sectionCount: {
    fontSize: 13,
    color: WT.textSecondary,
    backgroundColor: WT.bgCardAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 12,
  },
  cardThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: WT.bgCardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: WT.border,
  },
  thumbImage: {
    width: 56,
    height: 56,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.blue,
  },
  metaBadgeLabel: {
    fontSize: 13,
    color: WT.textSecondary,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: WT.textTertiary,
  },
  cardTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cardTimeText: {
    fontSize: 11,
    color: WT.textTertiary,
  },
  cardChevron: {
    width: 24,
    alignItems: 'center',
  },
  chevronText: {
    fontSize: 22,
    color: WT.textTertiary,
    fontWeight: '300',
  },
  separator: {
    height: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 32,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: WT.blueMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  emptySubtitle: {
    fontSize: 14,
    color: WT.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: WT.border,
  },
  footerText: {
    fontSize: 12,
    color: WT.textTertiary,
    letterSpacing: 0.3,
  },
});
