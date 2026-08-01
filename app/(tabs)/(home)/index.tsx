import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  ImageSourcePropType,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { BookMarked, BookOpen, Camera, CircuitBoard, Clock, GraduationCap, Info, Settings, Upload, X } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { loadSchematics, SchematicAnalysis } from '@/utils/schematic-storage';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import CircuitBackground from '@/components/CircuitBackground';
import { SchematicRasterizer, SchematicRasterizerHandle } from '@/components/SchematicRasterizer';
import { convertFilesToImageUris, pickSchematicFiles, UnsupportedFileError } from '@/utils/file-import';

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
    <Animated.View style={[{ transform: [{ scale }] }, disabled && { opacity: 0.6 }]}>
      <Pressable onPressIn={animIn} onPressOut={animOut} onPress={onPress} disabled={disabled} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function SchematicCard({ item, index, language }: { item: SchematicAnalysis; index: number; language: AppLanguage }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const es = isSpanish(language);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 70, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 70, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const dateDisplay = new Date(item.analyzedAt).toLocaleDateString(language === 'spanish' ? 'es-ES' : 'en-US', {
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
                {es ? ' cables' : ' wires'}
              </Text>
            </View>
            <View style={styles.metaDot} />
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>
                {item.componentCount}
              </Text>
              <Text style={styles.metaBadgeLabel}>
                {es ? ' partes' : ' parts'}
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
  const [language, setLanguage] = useState<AppLanguage>('english');
  const [uploading, setUploading] = useState(false);
  const [showUploadTip, setShowUploadTip] = useState(false);
  const scanScale = useRef(new Animated.Value(1)).current;
  const logoPulse = useRef(new Animated.Value(0)).current;
  const rasterizerRef = useRef<SchematicRasterizerHandle>(null);

  useFocusEffect(
    useCallback(() => {
      console.log('[Home] Screen focused — loading schematics');
      loadSchematics().then(setSchematics).catch(console.error);
      loadAppLanguage().then(setLanguage).catch(console.error);
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
  }, [scanScale]);

  // Pulsating "electricity" glow behind the header logo
  useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(logoPulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, [logoPulse]);

  const logoGlowScale = logoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.3] });
  const logoGlowOpacity = logoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });

  const handleScan = () => {
    console.log('[Home] Tapped Scan Schematic button');
    router.push('/camera');
  };

  const handleUpload = async () => {
    console.log('[Home] Tapped Upload Schematic button');
    if (uploading) return;
    try {
      const files = await pickSchematicFiles();
      if (files.length === 0) return;

      setUploading(true);
      const rasterizer = rasterizerRef.current;
      if (!rasterizer) throw new Error('Rasterizer not ready. Please try again.');

      const imageUris = await convertFilesToImageUris(files, rasterizer);
      if (imageUris.length === 0) {
        throw new Error(es ? 'No se pudo extraer ninguna página del archivo.' : 'Could not extract any pages from the file.');
      }

      if (imageUris.length === 1) {
        router.push({ pathname: '/analyze', params: { imageUri: imageUris[0] } });
      } else {
        router.push({ pathname: '/analyze', params: { imageUris: JSON.stringify(imageUris) } });
      }
    } catch (e) {
      console.error('[Home] Upload failed', e);
      const message =
        e instanceof UnsupportedFileError
          ? es
            ? `Los archivos .${e.fileName.split('.').pop()} (DXF/DWG) aún no son compatibles. Usa PDF, SVG o una imagen.`
            : `.${e.fileName.split('.').pop()} files (DXF/DWG) are not supported yet. Use a PDF, SVG, or image instead.`
          : e instanceof Error
          ? e.message
          : String(e);
      Alert.alert(es ? 'Error al subir' : 'Upload failed', message);
    } finally {
      setUploading(false);
    }
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
  const es = isSpanish(language);

  return (
    <View style={styles.root}>
      <CircuitBackground />
      <SchematicRasterizer ref={rasterizerRef} />
      <View style={styles.contentContainer}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: topPad }]}>
          <View style={styles.headerLeft}>
            <View style={styles.logoWrap}>
              <Animated.View
                style={[styles.logoGlow, { opacity: logoGlowOpacity, transform: [{ scale: logoGlowScale }] }]}
              />
              <Image source={require('@/assets/images/icon.png')} style={styles.logoImage} />
            </View>
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
                        <Camera size={26} color="#FFFFFF" strokeWidth={2} />
                        <Text style={styles.scanButtonText}>{es ? 'Escanear Esquema' : 'Scan Schematic'}</Text>
                        <Text style={styles.scanButtonSub}>{es ? 'Apunta la cámara al diagrama de cableado' : 'Point camera at a wire diagram'}</Text>
                      </View>
                    </AnimatedPressable>
                  </Animated.View>

                  {/* Upload Schematic quick-access */}
                  <AnimatedPressable onPress={handleUpload} style={styles.uploadBtn} scaleValue={0.97} disabled={uploading}>
                    {uploading ? (
                      <ActivityIndicator size="small" color={WT.blue} />
                    ) : (
                      <Upload size={15} color={WT.blue} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dictBtnText}>
                        {uploading ? (es ? 'Procesando...' : 'Processing...') : es ? 'Subir Esquema' : 'Upload Schematic'}
                      </Text>
                      <Text style={styles.dictBtnSub}>{es ? 'Imagen, PDF o SVG desde tu dispositivo' : 'Image, PDF, or SVG from your device'}</Text>
                    </View>
                    <AnimatedPressable
                      onPress={() => {
                        console.log('[Home] Upload tip info pressed');
                        setShowUploadTip(true);
                      }}
                      style={styles.uploadTipBtn}
                      scaleValue={0.9}
                    >
                      <Info size={13} color={WT.textSecondary} />
                    </AnimatedPressable>
                  </AnimatedPressable>

                  {/* Symbol Dictionary quick-access */}
                  <AnimatedPressable onPress={handleDictionary} style={styles.dictBtn} scaleValue={0.97}>
                    <BookOpen size={15} color={WT.blue} />
                    <Text style={styles.dictBtnText}>{es ? 'Diccionario de Símbolos' : 'Symbol Dictionary'}</Text>
                    <Text style={styles.dictBtnSub}>{es ? 'Guía de referencia para símbolos estándar' : 'Reference guide for all standard symbols'}</Text>
                  </AnimatedPressable>

                  {/* Standards Library quick-access */}
                  <AnimatedPressable
                    onPress={() => {
                      console.log('[Home] Tapped Standards Library');
                      router.push('/standards');
                    }}
                    style={styles.dictBtn}
                    scaleValue={0.97}
                  >
                    <BookMarked size={15} color={WT.blue} />
                    <Text style={styles.dictBtnText}>{es ? 'Biblioteca de Estándares' : 'Standards Library'}</Text>
                    <Text style={styles.dictBtnSub}>{es ? 'Esquemas verificados para tu equipo' : 'Verified schematics for your team'}</Text>
                  </AnimatedPressable>

                  {/* Quiz Mode quick-access */}
                  <AnimatedPressable
                    onPress={() => {
                      console.log('[Home] Tapped Quiz Mode');
                      router.push('/quiz');
                    }}
                    style={styles.dictBtn}
                    scaleValue={0.97}
                  >
                    <GraduationCap size={15} color={WT.blue} />
                    <Text style={styles.dictBtnText}>{es ? 'Modo de Cuestionario' : 'Quiz Mode'}</Text>
                    <Text style={styles.dictBtnSub}>{es ? 'Pon a prueba a tu equipo' : 'Test your crew'}</Text>
                  </AnimatedPressable>
                </View>

                {/* Section header */}
                {schematics.length > 0 && (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{es ? 'Esquemas Recientes' : 'Recent Schematics'}</Text>
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
                <Text style={styles.emptyTitle}>{es ? 'Aún no hay esquemas' : 'No schematics yet'}</Text>
                <Text style={styles.emptySubtitle}>
                  {es ? 'Toca Escanear para fotografiar un diagrama y comenzar' : 'Tap Scan to photograph a wire diagram and get started'}
                </Text>
              </View>
            }
            renderItem={({ item, index }) => <SchematicCard item={item} index={index} language={language} />}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />

        {/* Footer */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
          <Text style={styles.footerText}>{es ? 'Impulsado por Visión AI' : 'Powered by AI Vision'}</Text>
        </View>
      </View>

      {/* Upload tip modal */}
      <Modal visible={showUploadTip} transparent animationType="fade" onRequestClose={() => setShowUploadTip(false)}>
        <View style={styles.tipOverlay}>
          <View style={styles.tipCard}>
            <View style={styles.tipHeader}>
              <Text style={styles.tipTitle}>{es ? 'Mejores Resultados al Subir' : 'Get Better Scan Results'}</Text>
              <AnimatedPressable onPress={() => setShowUploadTip(false)} style={styles.tipCloseBtn} scaleValue={0.9}>
                <X size={20} color={WT.textSecondary} />
              </AnimatedPressable>
            </View>

            <ScrollView style={styles.tipBody}>
              <Text style={styles.tipIntro}>
                {es
                  ? 'Una foto normal de la cámara puede tener sombras, ángulo torcido o poco contraste, lo que dificulta que la AI lea el esquema. La app de escáner de tu teléfono corrige eso automáticamente y guarda un PDF limpio — sube ese PDF en vez de la foto para mejores resultados.'
                  : "A plain camera photo can have shadows, a skewed angle, or low contrast, which makes it harder for the AI to read the schematic. Your phone's built-in scanner app corrects that automatically and saves a clean PDF — upload that PDF instead of the raw photo for better results."}
              </Text>

              <Text style={styles.tipPlatform}>{es ? 'En iPhone (app Notas)' : 'On iPhone (Notes app)'}</Text>
              <Text style={styles.tipStep}>{es ? '1. Abre la app Notas y crea una nota nueva.' : '1. Open the Notes app and create a new note.'}</Text>
              <Text style={styles.tipStep}>{es ? '2. Toca el ícono de cámara → "Escanear documentos".' : '2. Tap the camera icon → "Scan Documents".'}</Text>
              <Text style={styles.tipStep}>{es ? '3. Captura el esquema; ajusta las esquinas si es necesario.' : '3. Capture the schematic; adjust the corners if needed.'}</Text>
              <Text style={styles.tipStep}>{es ? '4. Toca Guardar, luego Compartir → Guardar en Archivos como PDF.' : '4. Tap Save, then Share → Save to Files as PDF.'}</Text>

              <Text style={styles.tipPlatform}>{es ? 'En Android (Google Drive)' : 'On Android (Google Drive)'}</Text>
              <Text style={styles.tipStep}>{es ? '1. Abre la app Google Drive.' : '1. Open the Google Drive app.'}</Text>
              <Text style={styles.tipStep}>{es ? '2. Toca "+" → Escanear.' : '2. Tap "+" → Scan.'}</Text>
              <Text style={styles.tipStep}>{es ? '3. Captura el esquema; recorta y ajusta si es necesario.' : '3. Capture the schematic; crop and adjust if needed.'}</Text>
              <Text style={styles.tipStep}>{es ? '4. Guarda como PDF, luego súbelo aquí con "Subir Esquema".' : '4. Save as PDF, then upload it here with "Upload Schematic".'}</Text>
            </ScrollView>

            <AnimatedPressable onPress={() => setShowUploadTip(false)} style={styles.tipDoneBtn} scaleValue={0.97}>
              <Text style={styles.tipDoneBtnText}>{es ? 'Entendido' : 'Got It'}</Text>
            </AnimatedPressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: WT.bg,
  },
  contentContainer: {
    flex: 1,
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
  logoWrap: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlow: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: WT.blue,
  },
  logoImage: {
    width: 26,
    height: 26,
    borderRadius: 7,
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
    paddingTop: 22,
    paddingBottom: 24,
    gap: 8,
  },
  scanButton: {
    backgroundColor: WT.blue,
    borderRadius: 18,
    overflow: 'hidden',
  },
  scanButtonInner: {
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 7,
  },
  scanButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  scanButtonSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '400',
  },
  dictBtn: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: WT.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  uploadBtn: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: WT.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  dictBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.textPrimary,
    flex: 1,
  },
  dictBtnSub: {
    fontSize: 10.5,
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
  uploadTipBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.bgCardAlt,
  },
  tipOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  tipCard: {
    backgroundColor: WT.bgCard,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  tipTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: WT.textPrimary,
  },
  tipCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: WT.bgCardAlt,
  },
  tipBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: 380,
  },
  tipIntro: {
    fontSize: 14,
    color: WT.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  tipPlatform: {
    fontSize: 13,
    fontWeight: '700',
    color: WT.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tipStep: {
    fontSize: 14,
    color: WT.textPrimary,
    lineHeight: 21,
    marginBottom: 6,
  },
  tipDoneBtn: {
    marginTop: 16,
    marginHorizontal: 20,
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tipDoneBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
