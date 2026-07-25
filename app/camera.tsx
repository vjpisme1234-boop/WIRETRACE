import React, { useRef, useState } from 'react';
import {
  Animated,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Flashlight, FlashlightOff, Image as ImageIcon, Minus, Plus, X } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';

function resolveImageSource(source: string | number | ImageSourcePropType | undefined): ImageSourcePropType {
  if (!source) return { uri: '' };
  if (typeof source === 'string') return { uri: source };
  return source as ImageSourcePropType;
}

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

const MIN_ZOOM = 0;
const MAX_ZOOM = 1;
const ZOOM_STEP = 0.1;

// Display label: map zoom prop (0–1) to "1.0x"–"3.0x"
function zoomLabel(zoom: number): string {
  return `${(1 + zoom * 2).toFixed(1)}x`;
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();

  // A single captured URI pending preview decision
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // Accumulated pages for multi-page scanning
  const [pages, setPages] = useState<string[]>([]);

  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);

  const cameraRef = useRef<CameraView>(null);

  // -------------------------------------------------------------------------
  // Capture / gallery
  // -------------------------------------------------------------------------

  const handleCapture = async () => {
    console.log('[Camera] Shutter button pressed');
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        console.log('[Camera] Photo captured', { uri: photo.uri });
        setPreviewUri(photo.uri);
      }
    } catch (e) {
      console.error('[Camera] Capture failed', e);
    }
  };

  const handleGallery = async () => {
    console.log('[Camera] Gallery button pressed');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (!result.canceled && result.assets.length > 0) {
      const uris = result.assets.map((a) => a.uri);
      console.log('[Camera] Gallery images selected', { count: uris.length });
      if (uris.length === 1) {
        setPreviewUri(uris[0]);
      } else {
        // Multiple pages selected — go straight to multi-preview
        setPages(uris);
        setPreviewUri(null);
      }
    }
  };

  // -------------------------------------------------------------------------
  // Zoom helpers
  // -------------------------------------------------------------------------

  const handleZoomIn = () =>
    setZoom((z) => Math.min(MAX_ZOOM, parseFloat((z + ZOOM_STEP).toFixed(2))));
  const handleZoomOut = () =>
    setZoom((z) => Math.max(MIN_ZOOM, parseFloat((z - ZOOM_STEP).toFixed(2))));

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const navigateToAnalyze = (imageUri: string) => {
    router.replace({ pathname: '/analyze', params: { imageUri } });
  };

  const navigateToAnalyzeMulti = (uris: string[]) => {
    if (uris.length === 1) {
      navigateToAnalyze(uris[0]);
    } else {
      router.replace({ pathname: '/analyze', params: { imageUris: JSON.stringify(uris) } });
    }
  };

  // -------------------------------------------------------------------------
  // Preview controls
  // -------------------------------------------------------------------------

  const handleRetake = () => {
    console.log('[Camera] Retake pressed');
    setPreviewUri(null);
  };

  const handleAddAnotherPage = () => {
    if (!previewUri) return;
    console.log('[Camera] Add Another Page pressed');
    setPages((prev) => [...prev, previewUri]);
    setPreviewUri(null);
  };

  const handleUseCurrentPhoto = () => {
    if (!previewUri) return;
    console.log('[Camera] Use Photo pressed', { uri: previewUri });
    if (pages.length === 0) {
      navigateToAnalyze(previewUri);
    } else {
      navigateToAnalyzeMulti([...pages, previewUri]);
    }
  };

  const handleFinishPages = () => {
    console.log('[Camera] Finish pages pressed', { count: pages.length });
    navigateToAnalyzeMulti(pages);
  };

  const handleClearPages = () => {
    console.log('[Camera] Clear pages pressed');
    setPages([]);
    setPreviewUri(null);
  };

  // -------------------------------------------------------------------------
  // Permission screen
  // -------------------------------------------------------------------------

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.permissionContainer]}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionSub}>
          WireTrace AI needs camera access to photograph wire schematics.
        </Text>
        <AnimatedPressable onPress={() => {
          console.log('[Camera] Request permission pressed');
          requestPermission();
        }} style={styles.permissionBtn}>
          <Text style={styles.permissionBtnText}>Grant Camera Access</Text>
        </AnimatedPressable>
        <AnimatedPressable onPress={() => router.back()} style={styles.cancelTextBtn}>
          <Text style={styles.cancelTextBtnText}>Cancel</Text>
        </AnimatedPressable>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Multi-page accumulated preview (pages > 0, no current preview)
  // -------------------------------------------------------------------------

  if (pages.length > 0 && !previewUri) {
    return (
      <View style={styles.root}>
        <Image
          source={resolveImageSource(pages[0])}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        <View style={styles.dimOverlay} />

        {/* Page count badge */}
        <View style={[styles.pagesBadge, { top: insets.top + 16 }]}>
          <Text style={styles.pagesBadgeText}>{pages.length} page{pages.length !== 1 ? 's' : ''} queued</Text>
        </View>

        <AnimatedPressable
          onPress={handleClearPages}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          scaleValue={0.9}
        >
          <X size={22} color="#FFFFFF" />
        </AnimatedPressable>

        <View style={[styles.previewOverlay, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.previewLabel}>{pages.length} page{pages.length !== 1 ? 's' : ''} ready</Text>
          <Text style={styles.previewSub}>Add more pages or finish to analyze all at once</Text>
          <View style={styles.previewButtons}>
            <AnimatedPressable onPress={() => setPages([])} style={styles.retakeBtn}>
              <Text style={styles.retakeBtnText}>Clear All</Text>
            </AnimatedPressable>
            <AnimatedPressable onPress={() => setPreviewUri(null)} style={styles.addPageBtn}>
              <Text style={styles.addPageBtnText}>Add Page</Text>
            </AnimatedPressable>
          </View>
          <AnimatedPressable onPress={handleFinishPages} style={styles.finishBtn} scaleValue={0.97}>
            <Text style={styles.finishBtnText}>Analyze {pages.length} Pages →</Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Single-photo preview
  // -------------------------------------------------------------------------

  if (previewUri) {
    const totalPages = pages.length + 1;
    return (
      <View style={styles.root}>
        <Image
          source={resolveImageSource(previewUri)}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        {pages.length > 0 && (
          <View style={[styles.pagesBadge, { top: insets.top + 16 }]}>
            <Text style={styles.pagesBadgeText}>Page {totalPages} of scan</Text>
          </View>
        )}
        <AnimatedPressable
          onPress={handleRetake}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          scaleValue={0.9}
        >
          <X size={22} color="#FFFFFF" />
        </AnimatedPressable>
        <View style={[styles.previewOverlay, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.previewLabel}>
            {pages.length > 0 ? `Page ${totalPages} — looks good?` : 'Use this photo?'}
          </Text>
          {pages.length === 0 && (
            <Text style={styles.previewSub}>Tip: scan multiple pages to analyze an entire schematic book</Text>
          )}
          <View style={styles.previewButtons}>
            <AnimatedPressable onPress={handleRetake} style={styles.retakeBtn}>
              <Text style={styles.retakeBtnText}>Retake</Text>
            </AnimatedPressable>
            <AnimatedPressable onPress={handleAddAnotherPage} style={styles.addPageBtn}>
              <Text style={styles.addPageBtnText}>+ Add Page</Text>
            </AnimatedPressable>
          </View>
          <AnimatedPressable onPress={handleUseCurrentPhoto} style={styles.finishBtn} scaleValue={0.97}>
            <Text style={styles.finishBtnText}>
              {pages.length > 0 ? `Analyze All ${totalPages} Pages →` : 'Analyze Photo →'}
            </Text>
          </AnimatedPressable>
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Camera viewfinder
  // -------------------------------------------------------------------------

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        zoom={zoom}
      />

      {/* Corner-bracket viewfinder overlay */}
      <View style={styles.viewfinderContainer}>
        <View style={styles.viewfinder}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Text style={styles.viewfinderHint}>Align schematic within frame • Ensure good lighting</Text>
      </View>

      {/* Pages accumulated badge */}
      {pages.length > 0 && (
        <View style={[styles.pagesBadge, { top: insets.top + 16 }]}>
          <Text style={styles.pagesBadgeText}>{pages.length} page{pages.length !== 1 ? 's' : ''} captured</Text>
        </View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <AnimatedPressable
          onPress={() => {
            console.log('[Camera] Cancel pressed');
            if (pages.length > 0) {
              setPages([]);
            } else {
              router.back();
            }
          }}
          style={styles.closeBtn}
          scaleValue={0.9}
        >
          <X size={22} color="#FFFFFF" />
        </AnimatedPressable>

        <Text style={styles.topBarTitle}>Scan Schematic</Text>

        {/* Torch toggle */}
        <AnimatedPressable
          onPress={() => {
            console.log('[Camera] Torch toggled', { torch: !torch });
            setTorch((t) => !t);
          }}
          style={[styles.closeBtn, torch && styles.torchActive]}
          scaleValue={0.9}
        >
          {torch ? (
            <Flashlight size={20} color={WT.yellow} />
          ) : (
            <FlashlightOff size={20} color="#FFFFFF" />
          )}
        </AnimatedPressable>
      </View>

      {/* Zoom controls */}
      <View style={styles.zoomBar}>
        <AnimatedPressable
          onPress={handleZoomOut}
          disabled={zoom <= MIN_ZOOM}
          style={styles.zoomBtn}
          scaleValue={0.9}
        >
          <Minus size={18} color="#FFFFFF" />
        </AnimatedPressable>
        <View style={styles.zoomLabelBox}>
          <Text style={styles.zoomLabelText}>{zoomLabel(zoom)}</Text>
        </View>
        <AnimatedPressable
          onPress={handleZoomIn}
          disabled={zoom >= MAX_ZOOM}
          style={styles.zoomBtn}
          scaleValue={0.9}
        >
          <Plus size={18} color="#FFFFFF" />
        </AnimatedPressable>
      </View>

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <AnimatedPressable onPress={handleGallery} style={styles.sideBtn} scaleValue={0.9}>
          <ImageIcon size={26} color="#FFFFFF" />
          <Text style={styles.sideBtnLabel}>Gallery</Text>
        </AnimatedPressable>

        <AnimatedPressable onPress={handleCapture} style={styles.shutterOuter} scaleValue={0.93}>
          <View style={styles.shutterInner} />
        </AnimatedPressable>

        {/* "Done" shortcut if pages accumulated */}
        {pages.length > 0 ? (
          <AnimatedPressable onPress={handleFinishPages} style={styles.doneSideBtn} scaleValue={0.9}>
            <Text style={styles.doneSideBtnText}>Done</Text>
            <View style={styles.doneCountBadge}>
              <Text style={styles.doneCountText}>{pages.length}</Text>
            </View>
          </AnimatedPressable>
        ) : (
          <View style={{ width: 64 }} />
        )}
      </View>
    </View>
  );
}

const CORNER_SIZE = 28;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  permissionContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  permissionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: WT.textPrimary,
    textAlign: 'center',
  },
  permissionSub: {
    fontSize: 15,
    color: WT.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  permissionBtn: {
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  permissionBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelTextBtn: {
    paddingVertical: 12,
  },
  cancelTextBtnText: {
    fontSize: 16,
    color: WT.textSecondary,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  torchActive: {
    backgroundColor: 'rgba(255,214,10,0.25)',
    borderWidth: 1,
    borderColor: WT.yellow,
  },
  viewfinderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  viewfinder: {
    width: 290,
    height: 210,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderColor: WT.blue,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderColor: WT.blue,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderColor: WT.blue,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderColor: WT.blue,
    borderBottomRightRadius: 4,
  },
  viewfinderHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
  },
  pagesBadge: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: WT.blue,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  pagesBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  zoomBar: {
    position: 'absolute',
    bottom: 140,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  zoomBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabelBox: {
    minWidth: 48,
    alignItems: 'center',
  },
  zoomLabelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sideBtn: {
    width: 64,
    alignItems: 'center',
    gap: 4,
  },
  sideBtnLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
  },
  doneSideBtn: {
    width: 64,
    alignItems: 'center',
    gap: 4,
  },
  doneSideBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: WT.blue,
  },
  doneCountBadge: {
    backgroundColor: WT.blue,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  doneCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.80)',
    paddingTop: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  previewLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  previewSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 18,
  },
  previewButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  retakeBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  retakeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  addPageBtn: {
    flex: 1,
    backgroundColor: WT.blueMuted,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: WT.blue,
  },
  addPageBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: WT.blue,
  },
  finishBtn: {
    width: '100%',
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  finishBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
