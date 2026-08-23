import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  LayoutAnimation,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, GripVertical, ListChecks, Plus, X } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { getSchematic, saveSchematic, SchematicAnalysis, WireInfo } from '@/utils/schematic-storage';
import { isSpanish, loadAppLanguage } from '@/utils/app-language';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ROW_HEIGHT = 60;

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

function wireDotColor(color?: string): string {
  return (color && WIRE_COLOR_MAP[color.toLowerCase()]) || WT.blue;
}

interface DragBookkeeping {
  id: string | null;
  startIndex: number;
  currentIndex: number;
}

function OrderedWireRow({
  id,
  index,
  position,
  wire,
  dragRef,
  onDragMove,
  onDragRelease,
  onRemove,
}: {
  id: string;
  index: number;
  position: number;
  wire: WireInfo | undefined;
  dragRef: React.MutableRefObject<DragBookkeeping>;
  onDragMove: (id: string, index: number, dy: number) => void;
  onDragRelease: () => void;
  onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const translateY = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(index);
  indexRef.current = index;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragReleaseRef = useRef(onDragRelease);
  onDragReleaseRef.current = onDragRelease;

  const settle = useCallback(() => {
    // useNativeDriver must stay false here: translateY is driven by
    // setValue() on every move, and once a node has been handed to the native
    // driver those JS-side writes stop taking effect — the row then jumps or
    // sticks instead of following the finger.
    Animated.timing(translateY, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    setDragging(false);
    onDragReleaseRef.current();
  }, [translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragRef.current = { id, startIndex: indexRef.current, currentIndex: indexRef.current };
        translateY.setValue(0);
        setDragging(true);
      },
      onPanResponderMove: (_, g) => {
        onDragMoveRef.current(id, indexRef.current, g.dy);
        const shiftAbsorbed = (dragRef.current.currentIndex - dragRef.current.startIndex) * ROW_HEIGHT;
        translateY.setValue(g.dy - shiftAbsorbed);
      },
      onPanResponderRelease: settle,
      onPanResponderTerminate: settle,
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.orderRow,
        dragging && styles.orderRowDragging,
        { transform: [{ translateY }] },
      ]}
    >
      <View {...panResponder.panHandlers} style={styles.dragHandle} hitSlop={8}>
        <GripVertical size={18} color={WT.textSecondary} />
      </View>
      <View style={styles.positionBadge}>
        <Text style={styles.positionBadgeText}>{position}</Text>
      </View>
      <View style={[styles.wireDot, { backgroundColor: wireDotColor(wire?.color) }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.orderWireLabel} numberOfLines={1}>
          {wire?.label ?? id}
        </Text>
        {wire && (
          <Text style={styles.orderWireRoute} numberOfLines={1}>
            {wire.fromPoint} {'→'} {wire.toPoint}
          </Text>
        )}
      </View>
      <Pressable onPress={() => onRemove(id)} style={styles.removeBtn} hitSlop={8}>
        <X size={16} color={WT.textSecondary} />
      </Pressable>
    </Animated.View>
  );
}

const SWIPE_ARM = 10;      // horizontal travel before we claim the gesture
const SWIPE_COMMIT = 90;   // travel needed to actually add the wire

// A horizontal swipe is used rather than a vertical drag because the list
// lives in a vertical ScrollView: claiming only when the finger is moving
// sideways leaves scrolling completely untouched, instead of fighting the
// ScrollView for the same axis.
function AvailableWireRow({
  wire,
  onAdd,
}: {
  wire: WireInfo;
  onAdd: (id: string) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        g.dx > SWIPE_ARM && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        translateX.setValue(Math.max(0, g.dx));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx >= SWIPE_COMMIT) {
          // Carry the row off to the right, then hand it to the list. The add
          // unmounts this row, so there is nothing to spring back.
          Animated.timing(translateX, { toValue: 400, duration: 140, useNativeDriver: false }).start(
            () => onAddRef.current(wire.id)
          );
          return;
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
      },
    })
  ).current;

  const hintOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_COMMIT],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.swipeWrap}>
      <Animated.View style={[styles.swipeHint, { opacity: hintOpacity }]}>
        <Plus size={18} color={WT.green} />
      </Animated.View>
      <Animated.View
        {...responder.panHandlers}
        style={[styles.availableRow, { transform: [{ translateX }] }]}
      >
        <View style={[styles.wireDot, { backgroundColor: wireDotColor(wire.color) }]} />
        <Pressable onPress={() => onAdd(wire.id)} style={styles.availableTapArea}>
          <Text style={styles.orderWireLabel} numberOfLines={1}>{wire.label}</Text>
          <Text style={styles.orderWireRoute} numberOfLines={1}>
            {wire.fromPoint} {'→'} {wire.toPoint}
          </Text>
        </Pressable>
        <Pressable onPress={() => onAdd(wire.id)} style={styles.addBtn} hitSlop={8}>
          <Plus size={16} color={WT.blue} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function CustomReadingOrderScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ schematicId: string }>();

  const [schematic, setSchematic] = useState<SchematicAnalysis | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [es, setEs] = useState(false);
  const [saving, setSaving] = useState(false);

  const dragRef = useRef<DragBookkeeping>({ id: null, startIndex: 0, currentIndex: 0 });
  // handleDragMove needs the current length without re-creating the callback
  // on every reorder, which would hand each row a new PanResponder mid-drag.
  const orderRef = useRef<string[]>(order);
  orderRef.current = order;

  useEffect(() => {
    loadAppLanguage().then((lang) => setEs(isSpanish(lang)));
  }, []);

  useEffect(() => {
    if (!params.schematicId) return;
    getSchematic(params.schematicId).then((s) => {
      if (!s) return;
      setSchematic(s);
      setOrder(s.customWireOrder ?? []);
    });
  }, [params.schematicId]);

  const wireById = useMemo(() => {
    const map = new Map<string, WireInfo>();
    (schematic?.wires ?? []).forEach((w) => map.set(w.id, w));
    return map;
  }, [schematic]);

  const availableWires = useMemo(
    () => (schematic?.wires ?? []).filter((w) => !order.includes(w.id)),
    [schematic, order]
  );

  const handleAdd = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOrder((prev) => [...prev, id]);
  }, []);

  const handleAddAll = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOrder((prev) => [...prev, ...availableWires.map((w) => w.id)]);
  }, [availableWires]);





  const handleRemove = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOrder((prev) => prev.filter((x) => x !== id));
  }, []);

  const handleDragMove = useCallback((id: string, startingIndex: number, dy: number) => {
    if (dragRef.current.id !== id) return;

    // The bookkeeping ref is advanced HERE rather than inside the setOrder
    // updater. React may invoke an updater more than once for a single update
    // (it does exactly that under StrictMode in development), and this one
    // used to mutate dragRef.current.currentIndex as a side effect — so the
    // row's tracked position could advance twice for one move, splice from
    // the wrong slot, and land somewhere other than where it was dropped.
    // Updaters have to stay pure; the ref moves outside.
    const from = dragRef.current.currentIndex;
    const target = Math.max(
      0,
      Math.min(orderRef.current.length - 1, dragRef.current.startIndex + Math.round(dy / ROW_HEIGHT))
    );
    if (target === from) return;
    dragRef.current.currentIndex = target;

    setOrder((prev) => {
      if (from < 0 || from >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  const handleDragRelease = useCallback(() => {
    dragRef.current = { id: null, startIndex: 0, currentIndex: 0 };
  }, []);

  const handleSave = async () => {
    if (!schematic) return;
    setSaving(true);
    try {
      const updated: SchematicAnalysis = {
        ...schematic,
        customWireOrder: order,
        // The old cached readingSteps no longer reflect this selection —
        // clearing them forces a fresh generation next time reading starts.
        readingSteps: [],
        readingStepsStartLabel: undefined,
        pendingJunction: null,
      };
      await saveSchematic(updated);
      console.log('[CustomOrder] Saved custom wire order', { count: order.length });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!schematic) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>{es ? 'Cargando...' : 'Loading...'}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={22} color={WT.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{es ? 'Orden de Lectura Personalizado' : 'Custom Reading Order'}</Text>
        <Pressable onPress={handleSave} style={styles.iconBtn} disabled={saving} hitSlop={8}>
          <Check size={22} color={saving ? WT.textTertiary : WT.green} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={styles.hintBox}>
          <ListChecks size={15} color={WT.yellow} />
          <Text style={styles.hintText}>
            {es
              ? 'Desliza un cable hacia la derecha para añadirlo, o tócalo. Usa Añadir todos para agregarlos todos. Arrastra el ⋮⋮ para cambiar el orden. Solo los cables en la lista se leerán en voz alta, en este orden exacto.'
              : 'Swipe a wire right to add it, or just tap it. Use Add all to take them all. Drag the ⋮⋮ handle to reorder. Only the wires in the list will be read aloud, in this exact order.'}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>
          {es ? `ORDEN DE LECTURA (${order.length})` : `READING ORDER (${order.length})`}
        </Text>
        {order.length === 0 ? (
          <Text style={styles.emptyText}>
            {es ? 'Aún no has añadido ningún cable.' : "You haven't added any wires yet."}
          </Text>
        ) : (
          <View>
            {order.map((id, index) => (
              <OrderedWireRow
                key={id}
                id={id}
                index={index}
                position={index + 1}
                wire={wireById.get(id)}
                dragRef={dragRef}
                onDragMove={handleDragMove}
                onDragRelease={handleDragRelease}
                onRemove={handleRemove}
              />
            ))}
          </View>
        )}

        <View style={styles.availableHeader}>
          <Text style={[styles.sectionLabel, { marginTop: 0, marginHorizontal: 0, flex: 1 }]}>
            {es ? `TODOS LOS CABLES (${availableWires.length})` : `ALL WIRES (${availableWires.length})`}
          </Text>
          {availableWires.length > 0 ? (
            <Pressable onPress={handleAddAll} style={styles.addAllBtn} hitSlop={8}>
              <Plus size={14} color={WT.blue} />
              <Text style={styles.addAllBtnText}>
                {es ? `Añadir las ${availableWires.length}` : `Add all ${availableWires.length}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {availableWires.length === 0 ? (
          <Text style={styles.emptyText}>
            {es ? 'Todos los cables están en la lista.' : 'All wires are already in the list.'}
          </Text>
        ) : (
          <View>
            {availableWires.map((wire) => (
              <AvailableWireRow key={wire.id} wire={wire} onAdd={handleAdd} />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={handleSave} style={styles.saveBtn} disabled={saving}>
          <Text style={styles.saveBtnText}>
            {saving ? (es ? 'Guardando...' : 'Saving...') : es ? 'Guardar Orden' : 'Save Order'}
          </Text>
        </Pressable>
      </View>
    </View>
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
  },
  loadingText: {
    fontSize: 16,
    color: WT.textSecondary,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  hintBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: WT.border,
  },
  hintText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: WT.textSecondary,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.textTertiary,
    letterSpacing: 0.6,
    marginHorizontal: 16,
    marginTop: 18,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: WT.textTertiary,
    marginHorizontal: 16,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: ROW_HEIGHT - 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    backgroundColor: WT.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.border,
  },
  orderRowDragging: {
    borderColor: WT.blue,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 10,
  },
  dragHandle: {
    width: 28,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: WT.blueMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  positionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: WT.blue,
  },
  wireDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  orderWireLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: WT.textPrimary,
  },
  orderWireRoute: {
    fontSize: 11,
    color: WT.textSecondary,
    marginTop: 1,
  },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  availableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  addAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: WT.blueMuted,
    borderWidth: 1,
    borderColor: WT.blueDim,
  },
  addAllBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: WT.blue,
  },
  scrubHandle: {
    width: 30,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  availableTapArea: {
    flex: 1,
    justifyContent: 'center',
    height: '100%',
  },
  availableRowTaken: {
    opacity: 0.45,
    borderColor: WT.green,
  },
  availableRowScrubbing: {
    borderColor: WT.blue,
  },
  swipeWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  // Sits behind the row and is revealed as it slides right, so the gesture
  // shows what it is going to do before you commit to it.
  swipeHint: {
    position: 'absolute',
    left: 30,
    top: 0,
    bottom: 8,
    justifyContent: 'center',
  },
  availableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: ROW_HEIGHT - 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    backgroundColor: WT.bgCardAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: WT.border,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: WT.blueMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: WT.border,
  },
  saveBtn: {
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
