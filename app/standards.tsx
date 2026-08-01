import React, { useCallback, useRef, useState } from 'react';
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
import { ArrowLeft, BookMarked, Clock, GraduationCap } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import { listStandards, SchematicAnalysis } from '@/utils/schematic-storage';
import PulsingLogo from '@/components/PulsingLogo';

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
    <Animated.View style={[{ transform: [{ scale }] }]}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function StandardCard({ item, language }: { item: SchematicAnalysis; language: AppLanguage }) {
  const es = isSpanish(language);
  const dateDisplay = new Date(item.analyzedAt).toLocaleDateString(es ? 'es-ES' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <AnimatedPressable
      onPress={() => {
        console.log('[Standards] Opening standard', { id: item.id });
        router.push({ pathname: '/analyze', params: { schematicId: item.id } });
      }}
      style={styles.card}
    >
      <View style={styles.cardThumb}>
        {item.imageUri ? (
          <Image source={resolveImageSource(item.imageUri)} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <BookMarked size={26} color={WT.blue} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.standardName || item.name}
        </Text>
        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>
            {item.wireCount} {es ? 'cables' : 'wires'} · {item.componentCount} {es ? 'partes' : 'parts'}
          </Text>
        </View>
        <View style={styles.cardTime}>
          <Clock size={11} color={WT.textTertiary} />
          <Text style={styles.cardTimeText}>{dateDisplay}</Text>
        </View>
      </View>
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          console.log('[Standards] Starting quiz', { id: item.id });
          router.push({ pathname: '/quiz', params: { schematicId: item.id } });
        }}
        style={styles.quizBtn}
        hitSlop={8}
      >
        <GraduationCap size={18} color={WT.blue} />
      </Pressable>
    </AnimatedPressable>
  );
}

export default function StandardsScreen() {
  const insets = useSafeAreaInsets();
  const [standards, setStandards] = useState<SchematicAnalysis[]>([]);
  const [language, setLanguage] = useState<AppLanguage>('english');
  const es = isSpanish(language);

  useFocusEffect(
    useCallback(() => {
      listStandards().then(setStandards).catch(console.error);
      loadAppLanguage().then(setLanguage).catch(console.error);
    }, [])
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <AnimatedPressable onPress={() => router.back()} style={styles.backBtn} scaleValue={0.9}>
          <ArrowLeft size={22} color={WT.blue} />
        </AnimatedPressable>
        <View style={styles.headerCenter}>
          <PulsingLogo size={20} />
          <Text style={styles.headerTitle}>{es ? 'Biblioteca de Estándares' : 'Standards Library'}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Text style={styles.subtitle}>
        {es
          ? 'Esquemas verificados guardados como referencia confiable para tu equipo'
          : 'Verified schematics saved as a trusted reference for your team'}
      </Text>

      <FlatList
        data={standards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
        renderItem={({ item }) => <StandardCard item={item} language={language} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <BookMarked size={32} color={WT.blue} />
            </View>
            <Text style={styles.emptyTitle}>{es ? 'Aún no hay estándares' : 'No standards yet'}</Text>
            <Text style={styles.emptySubtitle}>
              {es
                ? 'Corrige un esquema escaneado y guárdalo como estándar para verlo aquí.'
                : 'Correct a scanned schematic and save it as a standard to see it here.'}
            </Text>
          </View>
        }
      />
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
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  listContent: {
    paddingHorizontal: 20,
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
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: WT.bgCardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: WT.border,
  },
  thumbImage: {
    width: 52,
    height: 52,
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
  },
  metaText: {
    fontSize: 12,
    color: WT.textSecondary,
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
  chevronText: {
    fontSize: 22,
    color: WT.textTertiary,
    fontWeight: '300',
  },
  quizBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.blueMuted,
    borderWidth: 1,
    borderColor: WT.blueDim,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 30,
    gap: 12,
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 18,
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
    lineHeight: 20,
  },
});
