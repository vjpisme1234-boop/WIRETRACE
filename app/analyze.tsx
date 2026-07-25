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
import { router, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Play,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
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
  }, []);
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
  }, [loading]);

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
      const msg = e instanceof Error ? e.message : 'Analysis failed';
      console.error('[Analyze] Analysis error', e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

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
      const msg = e instanceof Error ? e.message : 'Analysis failed';
      console.error('[Analyze] Multi-page analysis error', e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (params.schematicId) {
      console.log('[Analyze] Loading existing schematic', { id: params.schematicId });
      getSchematic(params.schematicId).then((s) => {
        if (s) setSchematic(s);
        else setError('Schematic not found');
      });
    } else if (params.imageUris) {
      const uris = JSON.parse(params.imageUris as string) as string[];
      console.log('[Analyze] Multi-page URIs received', { count: uris.length });
      runMultiAnalysis(uris);
    } else if (params.imageUri) {
      runAnalysis(params.imageUri);
    }
  }, []);

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
      const msg = e instanceof Error ? e.message : 'Failed to generate steps';
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
        <Text style={styles.confBadgeText}>{Math.round(confidence * 100)}%</Text>
      </View>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable onPress={() => {
          console.log('[Analyze] Back button pressed');
          router.back();
        }} style={styles.backBtn} scaleValue={0.9}>
          <ArrowLeft size={22} color={WT.blue} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Analyze Schematic</Text>
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
            <Text style={styles.loadingTitle}>Analyzing schematic...</Text>
            <Text style={styles.loadingSubtitle}>AI is extracting wires, components, and connections</Text>
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
              <Text style={styles.errorTitle}>Analysis failed</Text>
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
              <Text style={styles.retryBtnText}>Retry</Text>
            </AnimatedPressable>
          </View>
        )}

        {/* Results */}
        {schematic && !loading && (
          <>
            {/* Unknown symbols warning */}
            {unknownCount > 0 && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={18} color={WT.yellow} />
                <Text style={styles.warningText}>
                  {unknownCount}
                  {' unknown symbol'}
                  {unknownCount !== 1 ? 's' : ''}
                  {' found — identify them for best results'}
                </Text>
                <AnimatedPressable
                  onPress={() => {
                    console.log('[Analyze] Identify Now pressed');
                    const first = schematic.unknownSymbols.find((u) => !u.userIdentifiedAs);
                    if (first) handleIdentifyUnknown(first.id);
                  }}
                  style={styles.identifyNowBtn}
                >
                  <Text style={styles.identifyNowText}>Identify</Text>
                </AnimatedPressable>
              </View>
            )}

            {/* AI Summary */}
            {schematic.summary ? (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>AI Summary</Text>
                <Text style={styles.summaryText}>{schematic.summary}</Text>
              </View>
            ) : null}

            {/* Wire Summary */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Zap size={16} color={WT.blue} />
                <Text style={styles.cardTitle}>Wire Summary</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{schematic.wireCount}</Text>
                </View>
              </View>
              {schematic.wires.length === 0 ? (
                <Text style={styles.emptyCardText}>No wires detected</Text>
              ) : (
                schematic.wires.slice(0, 8).map((wire) => (
                  <View key={wire.id} style={styles.wireRow}>
                    <View style={[styles.wireColorDot, { backgroundColor: wireColor(wire.color) }]} />
                    <Text style={styles.wireLabel}>{wire.label}</Text>
                    <Text style={styles.wireRoute} numberOfLines={1}>
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
                  </View>
                ))
              )}
              {schematic.wires.length > 8 && (
                <Text style={styles.moreText}>
                  {'+'}
                  {schematic.wires.length - 8}
                  {' more wires'}
                </Text>
              )}
            </View>

            {/* Components */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Cpu size={16} color={WT.blue} />
                <Text style={styles.cardTitle}>Components Found</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{schematic.componentCount}</Text>
                </View>
              </View>
              {schematic.components.length === 0 ? (
                <Text style={styles.emptyCardText}>No components detected</Text>
              ) : (
                schematic.components.map((comp) => (
                  <View key={comp.id} style={styles.componentRow}>
                    <View style={styles.componentLeft}>
                      <Text style={styles.componentLabel}>{comp.label}</Text>
                      <View style={[styles.typeBadge, comp.isUnknown && styles.typeBadgeUnknown]}>
                        <Text style={[styles.typeBadgeText, comp.isUnknown && styles.typeBadgeTextUnknown]}>
                          {comp.userIdentifiedAs || comp.type}
                        </Text>
                      </View>
                      <ConfBadge confidence={comp.confidence} />
                    </View>
                    <Text style={styles.componentDesc} numberOfLines={2}>
                      {comp.description}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* Unknown Symbols */}
            {schematic.unknownSymbols.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <AlertTriangle size={16} color={WT.yellow} />
                  <Text style={styles.cardTitle}>Unknown Symbols</Text>
                  <View style={[styles.countBadge, styles.countBadgeWarning]}>
                    <Text style={[styles.countBadgeText, styles.countBadgeTextWarning]}>
                      {schematic.unknownSymbols.length}
                    </Text>
                  </View>
                </View>
                {schematic.unknownSymbols.map((sym) => (
                  <View key={sym.id} style={styles.unknownRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.unknownDesc}>{sym.description}</Text>
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
                        <Text style={styles.tapIdentifyText}>Identify</Text>
                      </AnimatedPressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Connections */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.connectionIcon}>
                  <Text style={styles.connectionIconText}>⟶</Text>
                </View>
                <Text style={styles.cardTitle}>Point-to-Point Connections</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{schematic.connections.length}</Text>
                </View>
              </View>
              {schematic.connections.length === 0 ? (
                <Text style={styles.emptyCardText}>No connections detected</Text>
              ) : (
                schematic.connections.slice(0, 6).map((conn) => (
                  <View key={conn.id} style={styles.connectionRow}>
                    <Text style={styles.connectionWire}>{conn.wireLabel}</Text>
                    <Text style={styles.connectionDesc} numberOfLines={2}>
                      {conn.description}
                    </Text>
                  </View>
                ))
              )}
              {schematic.connections.length > 6 && (
                <Text style={styles.moreText}>
                  {'+'}
                  {schematic.connections.length - 6}
                  {' more connections'}
                </Text>
              )}
            </View>

            {/* Reading Direction */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Reading Direction</Text>
              <View style={styles.directionToggle}>
                <AnimatedPressable
                  onPress={() => {
                    console.log('[Analyze] Direction set to forward');
                    setDirection('forward');
                  }}
                  style={[styles.dirBtn, direction === 'forward' && styles.dirBtnActive]}
                >
                  <Text style={[styles.dirBtnText, direction === 'forward' && styles.dirBtnTextActive]}>
                    Forward (Line 1 → End)
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
                    Backward (End → Line 1)
                  </Text>
                </AnimatedPressable>
              </View>

              <Text style={styles.startLabel}>Start Point</Text>
              <View style={styles.startOptions}>
                {(['beginning', 'end', 'specific'] as StartPoint[]).map((opt) => {
                  const labels: Record<StartPoint, string> = {
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
                      {specificStart || 'Search wires & components...'}
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
                        placeholder="Search..."
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
                        <Text style={styles.pickerEmpty}>No matches found</Text>
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
              <Text style={styles.startBtnText}>Generating steps...</Text>
            ) : (
              <>
                <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
                <Text style={styles.startBtnText}>Start Reading</Text>
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
});
