import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ArrowLeft, RotateCcw, StickyNote, ZoomIn, ZoomOut } from 'lucide-react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { WT } from '@/constants/wiretrace';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import { Connection, getSchematic, SchematicAnalysis, updateSchematic, WireInfo } from '@/utils/schematic-storage';
import CircuitBackground from '@/components/CircuitBackground';
import { DEMO_SCHEMATIC } from '@/utils/demo-schematic';
import PulsingLogo from '@/components/PulsingLogo';
import { speakText } from '@/utils/tts';

interface Pos {
  x: number;
  y: number;
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
    <Animated.View style={[{ transform: [{ scale }] }]}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Wire color decoding — mirrors the abbreviations the AI is allowed to use
// ---------------------------------------------------------------------------

const WIRE_COLOR_HEX: Record<string, string> = {
  black: '#5a5a5f',
  white: '#e8e8ee',
  gray: '#9a9aa2',
  grey: '#9a9aa2',
  green: '#34c759',
  red: '#ff453a',
  blue: '#0a84ff',
  yellow: '#ffd60a',
  orange: '#ff9f0a',
  brown: '#a9713f',
  violet: '#bf5af2',
  purple: '#bf5af2',
  pink: '#ff6482',
};

function resolveWireColor(color?: string): string {
  if (!color) return WT.blue;
  return WIRE_COLOR_HEX[color.toLowerCase().trim()] || WT.blue;
}

// ---------------------------------------------------------------------------
// Auto-layout — the AI gives us labels/connections, not pixel coordinates,
// so nodes are arranged in a simple grid rather than replicating the
// original photo's physical layout.
// ---------------------------------------------------------------------------

const NODE_W = 150;
const NODE_H = 56;
const COL_GAP = 210;
const ROW_GAP = 130;
const CANVAS_PAD = 70;

interface DiagramNode {
  key: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
}

interface DiagramEdge {
  id: string;
  fromKey: string;
  toKey: string;
  wireLabel: string;
  color: string;
  offset: number;
}

// A component often has several terminals referenced across connections
// (CR1-A1, CR1-A2, CR1-13...) — those all belong to ONE node, not one node
// per terminal string, or the same component shows up duplicated.
function resolveNodeKey(schematic: SchematicAnalysis, point: string): string {
  const p = point.trim();
  const prefix = p.split(/[-\s]/)[0].toUpperCase();
  const comp = schematic.components.find(
    (c) => c.label.toUpperCase() === prefix || c.label.toUpperCase() === p.toUpperCase()
  );
  return comp ? comp.label : p;
}

function buildDiagram(schematic: SchematicAnalysis) {
  const order: string[] = [];
  const seen = new Set<string>();
  const pushKey = (k: string) => {
    const key = resolveNodeKey(schematic, k);
    if (key && !seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  };
  schematic.connections.forEach((c) => {
    pushKey(c.from);
    pushKey(c.to);
  });
  if (order.length === 0) {
    schematic.components.forEach((c) => pushKey(c.label));
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(order.length || 1)));
  const nodeMap = new Map<string, DiagramNode>();

  order.forEach((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const comp = schematic.components.find((c) => c.label.toUpperCase() === key.toUpperCase());
    nodeMap.set(key, {
      key,
      label: comp ? comp.label : key,
      sub: comp ? comp.type : undefined,
      x: CANVAS_PAD + col * COL_GAP,
      y: CANVAS_PAD + row * ROW_GAP,
    });
  });

  const wireByLabel = new Map<string, WireInfo>();
  schematic.wires.forEach((w) => wireByLabel.set(w.label, w));

  const pairCounts = new Map<string, number>();
  const edges: DiagramEdge[] = [];

  schematic.connections.forEach((c: Connection) => {
    const from = nodeMap.get(resolveNodeKey(schematic, c.from));
    const to = nodeMap.get(resolveNodeKey(schematic, c.to));
    if (!from || !to) return;
    const pairKey = [from.key, to.key].sort().join('|');
    const idx = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, idx + 1);
    const wire = wireByLabel.get(c.wireLabel);
    edges.push({
      id: c.id,
      fromKey: from.key,
      toKey: to.key,
      wireLabel: c.wireLabel,
      color: resolveWireColor(wire?.color),
      offset: idx,
    });
  });

  const nodes = Array.from(nodeMap.values());
  const width = Math.max(...nodes.map((n) => n.x), 0) + NODE_W + CANVAS_PAD;
  const height = Math.max(...nodes.map((n) => n.y), 0) + NODE_H + CANVAS_PAD;

  return { nodes, edges, width: Math.max(width, 400), height: Math.max(height, 400) };
}

// ---------------------------------------------------------------------------
// Note annotations — user voice notes rendered as draggable sticky bubbles
// pinned near the node they were recorded on.
// ---------------------------------------------------------------------------

const NOTE_W = 170;
const NOTE_H = 60;

interface NoteAnnotation {
  id: string;
  text: string;
  nodeKey: string;
}

function buildNoteAnnotations(schematic: SchematicAnalysis): NoteAnnotation[] {
  const notes: NoteAnnotation[] = [];
  schematic.wires.forEach((w) => {
    if (w.userNote) {
      notes.push({
        id: `wire-${w.id}`,
        text: w.userNote,
        nodeKey: resolveNodeKey(schematic, w.toPoint || w.fromPoint || w.label),
      });
    }
  });
  schematic.components.forEach((c) => {
    if (c.userNote) {
      notes.push({ id: `comp-${c.id}`, text: c.userNote, nodeKey: c.label });
    }
  });
  return notes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

// Shrinks a center-to-center line so it visually terminates near each
// node's border instead of running through the label text. Node positions
// are looked up live so dragging a node keeps its wires attached.
function edgePath(edge: DiagramEdge, positions: Record<string, Pos>): { d: string; length: number } {
  const fromPos = positions[edge.fromKey] ?? { x: 0, y: 0 };
  const toPos = positions[edge.toKey] ?? { x: 0, y: 0 };
  const ax = fromPos.x + NODE_W / 2;
  const ay = fromPos.y + NODE_H / 2;
  const bx = toPos.x + NODE_W / 2;
  const by = toPos.y + NODE_H / 2;
  const dist = Math.max(1, Math.hypot(bx - ax, by - ay));
  const ux = (bx - ax) / dist;
  const uy = (by - ay) / dist;
  const shrink = Math.min(dist / 2 - 4, NODE_W / 2);
  const sx = ax + ux * shrink;
  const sy = ay + uy * shrink;
  const ex = bx - ux * shrink;
  const ey = by - uy * shrink;

  // Perpendicular offset so multiple wires between the same two nodes
  // don't perfectly overlap.
  const perpX = -uy;
  const perpY = ux;
  const offsetAmount = edge.offset * 14 * (edge.offset % 2 === 0 ? 1 : -1);
  const mx = (sx + ex) / 2 + perpX * offsetAmount;
  const my = (sy + ey) / 2 + perpY * offsetAmount;

  const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  const length = Math.hypot(ex - sx, ey - sy) + Math.abs(offsetAmount);
  return { d, length };
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const PULSE_LENGTH = 40;

function FlowEdge({ edge, positions }: { edge: DiagramEdge; positions: Record<string, Pos> }) {
  const fromPos = positions[edge.fromKey];
  const toPos = positions[edge.toKey];
  const { d, length } = useMemo(
    () => edgePath(edge, positions),
    [edge, fromPos?.x, fromPos?.y, toPos?.x, toPos?.y]
  );
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let stopped = false;
    const runCycle = () => {
      progress.setValue(0);
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 1800, useNativeDriver: false }),
        Animated.delay(250),
      ]).start(({ finished }) => {
        if (finished && !stopped) runCycle();
      });
    };
    runCycle();
    return () => {
      stopped = true;
      progress.stopAnimation();
    };
  }, [progress]);

  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [length + PULSE_LENGTH, -PULSE_LENGTH],
  });

  return (
    <>
      <Path d={d} stroke={edge.color} strokeWidth={2.5} fill="none" opacity={0.35} />
      <AnimatedPath
        d={d}
        stroke={edge.color}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={[PULSE_LENGTH, length + PULSE_LENGTH]}
        strokeDashoffset={dashOffset}
        opacity={0.95}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Draggable overlays — plain RN Views layered on top of the SVG canvas.
// PanResponder callbacks are created once (via useRef) but read live values
// out of refs each frame, since PanResponder.create() only runs on first
// render and would otherwise close over stale props.
// ---------------------------------------------------------------------------

function DraggableNode({
  node,
  pos,
  bounds,
  scaleRef,
  onMove,
  onRelease,
}: {
  node: DiagramNode;
  pos: Pos;
  bounds: { width: number; height: number };
  scaleRef: React.MutableRefObject<number>;
  onMove: (p: Pos) => void;
  onRelease: () => void;
}) {
  const posRef = useRef(pos);
  posRef.current = pos;
  const startRef = useRef(pos);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        startRef.current = posRef.current;
      },
      onPanResponderMove: (_, g) => {
        // Drag deltas arrive in screen pixels, but positions live in
        // unscaled canvas space — divide out the current zoom so the node
        // tracks the finger correctly at any zoom level.
        const s = scaleRef.current || 1;
        const b = boundsRef.current;
        const nx = clamp(startRef.current.x + g.dx / s, 0, b.width - NODE_W);
        const ny = clamp(startRef.current.y + g.dy / s, 0, b.height - NODE_H);
        onMoveRef.current({ x: nx, y: ny });
      },
      onPanResponderRelease: () => onReleaseRef.current(),
      onPanResponderTerminate: () => onReleaseRef.current(),
    })
  ).current;

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.nodeBox, { left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }]}
    >
      <Text style={styles.nodeLabel} numberOfLines={1}>
        {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
      </Text>
      {node.sub && (
        <Text style={styles.nodeSub} numberOfLines={1}>
          {node.sub.length > 20 ? node.sub.slice(0, 19) + '…' : node.sub}
        </Text>
      )}
    </View>
  );
}

function DraggableNote({
  note,
  pos,
  bounds,
  scaleRef,
  onMove,
  onRelease,
  onTap,
}: {
  note: NoteAnnotation;
  pos: Pos;
  bounds: { width: number; height: number };
  scaleRef: React.MutableRefObject<number>;
  onMove: (p: Pos) => void;
  onRelease: () => void;
  onTap: () => void;
}) {
  const posRef = useRef(pos);
  posRef.current = pos;
  const startRef = useRef(pos);
  const movedRef = useRef(false);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = posRef.current;
        movedRef.current = false;
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) movedRef.current = true;
        const s = scaleRef.current || 1;
        const b = boundsRef.current;
        const nx = clamp(startRef.current.x + g.dx / s, 0, b.width - NOTE_W);
        const ny = clamp(startRef.current.y + g.dy / s, 0, b.height - NOTE_H);
        onMoveRef.current({ x: nx, y: ny });
      },
      onPanResponderRelease: () => {
        if (movedRef.current) {
          onReleaseRef.current();
        } else {
          onTapRef.current();
        }
      },
      onPanResponderTerminate: () => onReleaseRef.current(),
    })
  ).current;

  return (
    <View {...panResponder.panHandlers} style={[styles.noteBubble, { left: pos.x, top: pos.y, width: NOTE_W }]}>
      <StickyNote size={12} color={WT.bg} />
      <Text style={styles.noteBubbleText} numberOfLines={3}>
        {note.text}
      </Text>
    </View>
  );
}

export default function SchematicViewScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ schematicId?: string }>();
  const [language, setLanguage] = useState<AppLanguage>('english');
  const [schematic, setSchematic] = useState<SchematicAnalysis | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const es = isSpanish(language);

  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [notePositions, setNotePositions] = useState<Record<string, Pos>>({});
  const positionsRef = useRef<Record<string, Pos>>({});
  const notePositionsRef = useRef<Record<string, Pos>>({});

  // Zoom: scaleAnim drives the live visual transform (updated continuously
  // during a pinch), scaleRef mirrors it for synchronous reads inside plain
  // PanResponder callbacks (node/note dragging), and committedScale resizes
  // the actual scrollable canvas — only on gesture end / button press, so a
  // mid-pinch canvas doesn't keep resizing the ScrollView underneath the
  // fingers.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const scaleRef = useRef(1);
  const baseScaleRef = useRef(1);
  const [committedScale, setCommittedScale] = useState(1);
  const [displayScale, setDisplayScale] = useState(1);

  const applyScale = (next: number, animate: boolean) => {
    const clamped = clamp(next, MIN_SCALE, MAX_SCALE);
    scaleRef.current = clamped;
    setDisplayScale(clamped);
    setCommittedScale(clamped);
    if (animate) {
      Animated.timing(scaleAnim, { toValue: clamped, duration: 180, useNativeDriver: true }).start();
    } else {
      scaleAnim.setValue(clamped);
    }
  };

  const pinchGesture = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      baseScaleRef.current = scaleRef.current;
    })
    .onUpdate((e) => {
      const next = clamp(baseScaleRef.current * e.scale, MIN_SCALE, MAX_SCALE);
      scaleRef.current = next;
      scaleAnim.setValue(next);
      setDisplayScale(next);
    })
    .onEnd(() => {
      setCommittedScale(scaleRef.current);
    });

  useFocusEffect(
    React.useCallback(() => {
      loadAppLanguage().then(setLanguage).catch(console.error);
    }, [])
  );

  useEffect(() => {
    if (!params.schematicId) {
      setSchematic(DEMO_SCHEMATIC);
      setIsDemo(true);
      return;
    }
    getSchematic(params.schematicId).then((s) => {
      if (s) {
        setSchematic(s);
        setIsDemo(false);
      } else {
        setSchematic(DEMO_SCHEMATIC);
        setIsDemo(true);
      }
    });
  }, [params.schematicId]);

  const diagram = useMemo(() => (schematic ? buildDiagram(schematic) : null), [schematic]);
  const notes = useMemo(() => (schematic ? buildNoteAnnotations(schematic) : []), [schematic]);

  useEffect(() => {
    if (!diagram || !schematic) return;
    const initial: Record<string, Pos> = {};
    diagram.nodes.forEach((n) => {
      const saved = schematic.nodePositions?.[n.key];
      initial[n.key] = saved ? { x: saved.x, y: saved.y } : { x: n.x, y: n.y };
    });
    setPositions(initial);
    positionsRef.current = initial;

    const initialNotes: Record<string, Pos> = {};
    notes.forEach((note, i) => {
      const saved = schematic.notePositions?.[note.id];
      if (saved) {
        initialNotes[note.id] = { x: saved.x, y: saved.y };
      } else {
        const anchor = initial[note.nodeKey] ?? { x: CANVAS_PAD, y: CANVAS_PAD };
        initialNotes[note.id] = { x: anchor.x + NODE_W + 24, y: anchor.y + (i % 3) * (NOTE_H + 10) };
      }
    });
    setNotePositions(initialNotes);
    notePositionsRef.current = initialNotes;
  }, [diagram, schematic?.id]);

  const canvasWidth = (diagram?.width ?? 400) + 240;
  const canvasHeight = (diagram?.height ?? 400) + 160;

  const persistPositions = () => {
    if (isDemo || !schematic) return;
    updateSchematic(schematic.id, {
      nodePositions: positionsRef.current,
      notePositions: notePositionsRef.current,
    }).catch((e) => console.error('[SchematicView] Failed to persist layout', e));
  };

  const updateNodePosition = (key: string, pos: Pos) => {
    const next = { ...positionsRef.current, [key]: pos };
    positionsRef.current = next;
    setPositions(next);
  };

  const updateNotePosition = (id: string, pos: Pos) => {
    const next = { ...notePositionsRef.current, [id]: pos };
    notePositionsRef.current = next;
    setNotePositions(next);
  };

  const resetLayout = () => {
    if (!diagram || !schematic) return;
    const fresh: Record<string, Pos> = {};
    diagram.nodes.forEach((n) => {
      fresh[n.key] = { x: n.x, y: n.y };
    });
    setPositions(fresh);
    positionsRef.current = fresh;

    const freshNotes: Record<string, Pos> = {};
    notes.forEach((note, i) => {
      const anchor = fresh[note.nodeKey] ?? { x: CANVAS_PAD, y: CANVAS_PAD };
      freshNotes[note.id] = { x: anchor.x + NODE_W + 24, y: anchor.y + (i % 3) * (NOTE_H + 10) };
    });
    setNotePositions(freshNotes);
    notePositionsRef.current = freshNotes;

    if (!isDemo) {
      updateSchematic(schematic.id, { nodePositions: undefined, notePositions: undefined }).catch((e) =>
        console.error('[SchematicView] Failed to reset layout', e)
      );
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <CircuitBackground />

      <View style={styles.header}>
        <AnimatedPressable onPress={() => router.back()} style={styles.backBtn} scaleValue={0.9}>
          <ArrowLeft size={22} color={WT.blue} />
        </AnimatedPressable>
        <View style={styles.headerCenter}>
          <PulsingLogo size={20} />
          <Text style={styles.headerTitle}>{es ? 'Diagrama del Esquema' : 'Schematic Diagram'}</Text>
        </View>
        <AnimatedPressable onPress={resetLayout} style={styles.backBtn} scaleValue={0.9}>
          <RotateCcw size={18} color={WT.textSecondary} />
        </AnimatedPressable>
      </View>

      {schematic && diagram && (
        <>
          {isDemo && (
            <View style={styles.demoBanner}>
              <Text style={styles.demoBannerText}>
                {es
                  ? 'Ejemplo — esto muestra datos de muestra. Escanea un esquema real para verlo aquí.'
                  : 'Example — showing sample data. Scan a real schematic to see it here.'}
              </Text>
            </View>
          )}
          <Text style={styles.subtitle}>
            {es
              ? `${schematic.wires.length} cables · ${schematic.components.length} componentes · arrastra para reorganizar · pellizca o usa +/− para acercar`
              : `${schematic.wires.length} wires · ${schematic.components.length} components · drag to rearrange · pinch or use +/− to zoom in on wires`}
          </Text>
          <GestureDetector gesture={pinchGesture}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ width: canvasWidth * committedScale, height: canvasHeight * committedScale }}>
                  <Animated.View
                    style={{
                      width: canvasWidth,
                      height: canvasHeight,
                      transform: [{ scale: scaleAnim }],
                      transformOrigin: 'top left',
                    }}
                  >
                    <Svg width={canvasWidth} height={canvasHeight} style={StyleSheet.absoluteFill}>
                      {diagram.edges.map((edge) => (
                        <FlowEdge key={edge.id} edge={edge} positions={positions} />
                      ))}
                      {diagram.edges.map((edge) => {
                        const { d } = edgePath(edge, positions);
                        const mid = d.match(/Q ([\d.-]+) ([\d.-]+)/);
                        const lx = mid ? parseFloat(mid[1]) : 0;
                        const ly = mid ? parseFloat(mid[2]) : 0;
                        return (
                          <React.Fragment key={`label-${edge.id}`}>
                            <Rect x={lx - 16} y={ly - 10} width={32} height={18} rx={4} fill={WT.bg} opacity={0.85} />
                            <SvgText x={lx} y={ly + 3} fontSize={11} fontWeight="700" fill={edge.color} textAnchor="middle">
                              {edge.wireLabel}
                            </SvgText>
                          </React.Fragment>
                        );
                      })}
                    </Svg>

                    {diagram.nodes.map((node) => {
                      const pos = positions[node.key];
                      if (!pos) return null;
                      return (
                        <DraggableNode
                          key={node.key}
                          node={node}
                          pos={pos}
                          bounds={{ width: canvasWidth, height: canvasHeight }}
                          scaleRef={scaleRef}
                          onMove={(p) => updateNodePosition(node.key, p)}
                          onRelease={persistPositions}
                        />
                      );
                    })}

                    {notes.map((note) => {
                      const pos = notePositions[note.id];
                      if (!pos) return null;
                      return (
                        <DraggableNote
                          key={note.id}
                          note={note}
                          pos={pos}
                          bounds={{ width: canvasWidth, height: canvasHeight }}
                          scaleRef={scaleRef}
                          onMove={(p) => updateNotePosition(note.id, p)}
                          onRelease={persistPositions}
                          onTap={() => speakText(note.text)}
                        />
                      );
                    })}
                  </Animated.View>
                </View>
              </ScrollView>
            </ScrollView>
          </GestureDetector>

          <View style={[styles.zoomControls, { bottom: insets.bottom + 16 }]}>
            <Pressable onPress={() => applyScale(scaleRef.current * 1.25, true)} style={styles.zoomBtn} hitSlop={6}>
              <ZoomIn size={18} color={WT.textPrimary} />
            </Pressable>
            <Text style={styles.zoomPercent}>{Math.round(displayScale * 100)}%</Text>
            <Pressable onPress={() => applyScale(scaleRef.current / 1.25, true)} style={styles.zoomBtn} hitSlop={6}>
              <ZoomOut size={18} color={WT.textPrimary} />
            </Pressable>
            <Pressable onPress={() => applyScale(1, true)} style={styles.zoomResetBtn} hitSlop={6}>
              <Text style={styles.zoomResetText}>{es ? 'Restablecer' : 'Reset'}</Text>
            </Pressable>
          </View>
        </>
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: WT.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
  demoBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: WT.yellowMuted,
    borderWidth: 1,
    borderColor: WT.yellow,
  },
  demoBannerText: {
    fontSize: 12,
    color: WT.yellow,
    textAlign: 'center',
  },
  nodeBox: {
    position: 'absolute',
    borderRadius: 12,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.blue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  nodeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: WT.textPrimary,
    textAlign: 'center',
  },
  nodeSub: {
    fontSize: 10,
    color: WT.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  noteBubble: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: WT.yellow,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  noteBubbleText: {
    fontSize: 11,
    color: WT.bg,
    fontWeight: '600',
    flex: 1,
  },
  zoomControls: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: WT.bgCard,
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: WT.border,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomPercent: {
    fontSize: 12,
    fontWeight: '700',
    color: WT.textSecondary,
    minWidth: 38,
    textAlign: 'center',
  },
  zoomResetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    marginLeft: 2,
    backgroundColor: WT.blueMuted,
  },
  zoomResetText: {
    fontSize: 12,
    fontWeight: '700',
    color: WT.blue,
  },
});
