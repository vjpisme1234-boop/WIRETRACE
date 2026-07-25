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
import { X, Image as ImageIcon } from 'lucide-react-native';
import { WT } from '@/constants/wiretrace';
import { canAnalyzeMore } from '@/utils/schematic-storage';
import { usePremium } from '@/contexts/PremiumContext';

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

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [hasScanAllowance, setHasScanAllowance] = useState(true);
  const cameraRef = useRef<CameraView>(null);
  const { isPremium, isReady } = usePremium();

  React.useEffect(() => {
    const checkAllowance = async () => {
      if (!isReady || isPremium) {
        setHasScanAllowance(true);
        return;
      }
      const allowed = await canAnalyzeMore();
      setHasScanAllowance(allowed);
      if (!allowed) {
        router.replace('/paywall');
      }
    };
    checkAllowance();
  }, [isPremium, isReady]);

  const ensureScanAllowed = async (): Promise<boolean> => {
    if (isPremium) return true;
    const allowed = await canAnalyzeMore();
    if (!allowed) {
      setHasScanAllowance(false);
      router.push('/paywall');
      return false;
    }
    return true;
  };

  const handleCapture = async () => {
    console.log('[Camera] Shutter button pressed');
    if (!(await ensureScanAllowed())) return;
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) {
        console.log('[Camera] Photo captured', { uri: photo.uri });
        setCapturedUri(photo.uri);
      }
    } catch (e) {
      console.error('[Camera] Capture failed', e);
    }
  };

  const handleGallery = async () => {
    console.log('[Camera] Gallery button pressed');
    if (!(await ensureScanAllowed())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      console.log('[Camera] Gallery image selected', { uri: result.assets[0].uri });
      setCapturedUri(result.assets[0].uri);
    }
  };

  const handleCancel = () => {
    console.log('[Camera] Cancel button pressed');
    if (capturedUri) {
      setCapturedUri(null);
    } else {
      router.back();
    }
  };

  const handleUsePhoto = () => {
    if (!capturedUri) return;
    console.log('[Camera] Use Photo pressed', { uri: capturedUri });
    router.replace({ pathname: '/analyze', params: { imageUri: capturedUri } });
  };

  const handleRetake = () => {
    console.log('[Camera] Retake pressed');
    setCapturedUri(null);
  };

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!hasScanAllowance) {
    return <View style={styles.root} />;
  }

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

  // Preview mode
  if (capturedUri) {
    return (
      <View style={styles.root}>
        <Image
          source={resolveImageSource(capturedUri)}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
        <View style={[styles.previewOverlay, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.previewLabel}>Use this photo?</Text>
          <View style={styles.previewButtons}>
            <AnimatedPressable onPress={handleRetake} style={styles.retakeBtn}>
              <Text style={styles.retakeBtnText}>Retake</Text>
            </AnimatedPressable>
            <AnimatedPressable onPress={handleUsePhoto} style={styles.usePhotoBtn}>
              <Text style={styles.usePhotoBtnText}>Use Photo</Text>
            </AnimatedPressable>
          </View>
        </View>
        <AnimatedPressable
          onPress={handleCancel}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          scaleValue={0.9}
        >
          <X size={22} color="#FFFFFF" />
        </AnimatedPressable>
      </View>
    );
  }

  // Camera viewfinder
  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Corner brackets overlay */}
      <View style={styles.viewfinderContainer}>
        <View style={styles.viewfinder}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <Text style={styles.viewfinderHint}>Align schematic within frame</Text>
      </View>

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <AnimatedPressable onPress={handleCancel} style={styles.closeBtn} scaleValue={0.9}>
          <X size={22} color="#FFFFFF" />
        </AnimatedPressable>
        <Text style={styles.topBarTitle}>Scan Schematic</Text>
        <View style={{ width: 44 }} />
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

        <View style={{ width: 64 }} />
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
  viewfinderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  viewfinder: {
    width: 280,
    height: 200,
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
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
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
  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingTop: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 16,
  },
  previewLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  previewButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  retakeBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  retakeBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  usePhotoBtn: {
    flex: 1,
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  usePhotoBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
