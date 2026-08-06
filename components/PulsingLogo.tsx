import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';
import { WT } from '@/constants/wiretrace';

interface PulsingLogoProps {
  /** Overall footprint (glow included). The icon image itself renders ~87% of this. */
  size?: number;
}

export default function PulsingLogo({ size = 22 }: PulsingLogoProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, [pulse]);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.3] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });
  const imageSize = Math.round(size * 0.87);

  return (
    <Animated.View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.glow,
          {
            width: size,
            height: size,
            borderRadius: Math.round(size * 0.3),
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
      />
      <Image
        source={require('@/assets/images/icon.png')}
        style={{ width: imageSize, height: imageSize, borderRadius: Math.round(imageSize * 0.27) }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: WT.blue,
  },
});
