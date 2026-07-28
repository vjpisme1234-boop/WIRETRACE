import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Line, Path, Pattern, Rect } from 'react-native-svg';

const TILE = 96;
const PULSE_LENGTH = 70;

const AnimatedPath = Animated.createAnimatedComponent(Path);

type FlowTrace = {
  d: string;
  length: number;
  duration: number;
  delay: number;
};

function buildFlowTraces(width: number, height: number): FlowTrace[] {
  const rows = [0.16, 0.34, 0.52, 0.7, 0.86];
  return rows.map((r, i) => {
    const y = Math.round(height * r);
    const bendX = Math.round(width * (i % 2 === 0 ? 0.68 : 0.32));
    const bendY = Math.round(height * (r + (i % 2 === 0 ? 0.09 : -0.09)));
    const d = `M -20 ${y} H ${bendX} V ${bendY} H ${width + 20}`;
    const length = Math.abs(bendX + 20) + Math.abs(bendY - y) + Math.abs(width + 20 - bendX);
    return { d, length, duration: 3400 + i * 550, delay: i * 550 };
  });
}

function FlowLine({ trace }: { trace: FlowTrace }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let stopped = false;
    const runCycle = () => {
      progress.setValue(0);
      Animated.sequence([
        Animated.delay(trace.delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: trace.duration,
          useNativeDriver: false,
        }),
        Animated.delay(400),
      ]).start(({ finished }) => {
        if (finished && !stopped) runCycle();
      });
    };
    runCycle();
    return () => {
      stopped = true;
      progress.stopAnimation();
    };
  }, [progress, trace.delay, trace.duration]);

  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [trace.length + PULSE_LENGTH, -PULSE_LENGTH],
  });

  return (
    <>
      <AnimatedPath
        d={trace.d}
        stroke="#00B4FF"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        opacity={0.18}
        strokeDasharray={[PULSE_LENGTH, trace.length + PULSE_LENGTH]}
        strokeDashoffset={dashOffset}
      />
      <AnimatedPath
        d={trace.d}
        stroke="#7BE8FF"
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={[PULSE_LENGTH, trace.length + PULSE_LENGTH]}
        strokeDashoffset={dashOffset}
      />
    </>
  );
}

export default function CircuitBackground() {
  const { width, height } = useWindowDimensions();
  const flowTraces = useMemo(() => buildFlowTraces(width, height), [width, height]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['#0D1420', '#0A0A0F', '#050507']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="circuit" width={TILE} height={TILE} patternUnits="userSpaceOnUse">
            <Line x1={TILE * 0.5} y1={0} x2={TILE * 0.5} y2={TILE * 0.35} stroke="rgba(0,180,255,0.16)" strokeWidth={1.5} />
            <Line x1={TILE * 0.5} y1={TILE * 0.35} x2={TILE * 0.85} y2={TILE * 0.35} stroke="rgba(0,180,255,0.16)" strokeWidth={1.5} />
            <Line x1={TILE * 0.85} y1={TILE * 0.35} x2={TILE * 0.85} y2={TILE} stroke="rgba(0,180,255,0.16)" strokeWidth={1.5} />
            <Line x1={0} y1={TILE * 0.7} x2={TILE * 0.25} y2={TILE * 0.7} stroke="rgba(0,180,255,0.12)" strokeWidth={1.5} />
            <Line x1={TILE * 0.25} y1={TILE * 0.7} x2={TILE * 0.25} y2={TILE * 0.45} stroke="rgba(0,180,255,0.12)" strokeWidth={1.5} />
            <Circle cx={TILE * 0.5} cy={TILE * 0.35} r={2.5} fill="rgba(0,180,255,0.32)" />
            <Circle cx={TILE * 0.85} cy={TILE * 0.35} r={2} fill="rgba(0,180,255,0.24)" />
            <Circle cx={TILE * 0.25} cy={TILE * 0.45} r={2} fill="rgba(0,180,255,0.2)" />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#circuit)" />

        {flowTraces.map((trace, i) => (
          <React.Fragment key={i}>
            <Path d={trace.d} stroke="rgba(0,180,255,0.1)" strokeWidth={1.5} fill="none" />
            <FlowLine trace={trace} />
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}
