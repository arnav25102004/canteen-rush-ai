import React, { useMemo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  useFrameCallback,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ExpressiveLoadingIndicatorProps } from './LoadingIndicator.types';
import { useAppTheme } from '../../theme/ThemeProvider';

/**
 * 7 Canonical Material 3 Expressive Morphing Polygons (Normalized to 38x38 canvas):
 * Standard Sequence: SoftBurst -> Cookie-9 -> Pentagon -> Pill -> Sunny -> Cookie-4 -> Oval
 */
const NUM_POINTS = 36; // 36 vertex points for smooth continuous interpolation

function generatePolygonVertices(type: string): [number, number][] {
  const center = 19;
  const r = 16;
  const points: [number, number][] = [];

  for (let i = 0; i < NUM_POINTS; i++) {
    const theta = (i / NUM_POINTS) * 2 * Math.PI - Math.PI / 2;
    let rad = r;

    switch (type) {
      case 'SoftBurst': {
        // 8 soft lobes
        const mod = Math.sin(theta * 8) * 0.25;
        rad = r * (0.8 + mod);
        break;
      }
      case 'Cookie-9': {
        // 9-sided undulating cookie
        const mod = Math.sin(theta * 9) * 0.18;
        rad = r * (0.85 + mod);
        break;
      }
      case 'Pentagon': {
        // 5-sided regular polygon with soft bevel
        const pAngle = (2 * Math.PI) / 5;
        const offset = theta % pAngle;
        rad = r * (0.88 / Math.cos(offset - pAngle / 2));
        rad = Math.min(r, Math.max(r * 0.65, rad));
        break;
      }
      case 'Pill': {
        // Horizontal squircle / pill
        const cos = Math.abs(Math.cos(theta));
        const sin = Math.abs(Math.sin(theta));
        rad = r * Math.pow(Math.pow(cos, 3.5) + Math.pow(sin, 3.5), -1 / 3.5) * 0.92;
        break;
      }
      case 'Sunny': {
        // 12-pointed sunburst star
        const mod = Math.sin(theta * 12) * 0.3;
        rad = r * (0.75 + mod);
        break;
      }
      case 'Cookie-4': {
        // 4-leaf clover / 4-sided rounded cookie
        const mod = Math.cos(theta * 4) * 0.24;
        rad = r * (0.82 + mod);
        break;
      }
      case 'Oval':
      default: {
        // Smooth oval / circle
        rad = r * (1 + 0.15 * Math.sin(theta * 2));
        break;
      }
    }

    const x = center + rad * Math.cos(theta);
    const y = center + rad * Math.sin(theta);
    points.push([x, y]);
  }
  return points;
}

const SHAPES_STANDARD = ['SoftBurst', 'Cookie-9', 'Pentagon', 'Pill', 'Sunny', 'Cookie-4', 'Oval'];
const SHAPES_ICON_MODE = ['SoftBurst', 'Cookie-9', 'Pill', 'Sunny', 'Cookie-4', 'Oval'];

const SHAPE_VERTICES_CACHE: Record<string, [number, number][]> = {
  SoftBurst: generatePolygonVertices('SoftBurst'),
  'Cookie-9': generatePolygonVertices('Cookie-9'),
  Pentagon: generatePolygonVertices('Pentagon'),
  Pill: generatePolygonVertices('Pill'),
  Sunny: generatePolygonVertices('Sunny'),
  'Cookie-4': generatePolygonVertices('Cookie-4'),
  Oval: generatePolygonVertices('Oval'),
};

function verticesToSvgPath(v: [number, number][]): string {
  if (v.length === 0) return '';
  let d = `M ${v[0][0].toFixed(2)} ${v[0][1].toFixed(2)}`;
  for (let i = 1; i < v.length; i++) {
    d += ` L ${v[i][0].toFixed(2)} ${v[i][1].toFixed(2)}`;
  }
  return d + ' Z';
}

/**
 * Material 3 Expressive Loading Indicator (Android 15 Architecture)
 * 
 * 1. Shape Sequence: Deterministic cycling through expressive M3 primitives.
 * 2. Dual-Layer Composite Rotation System:
 *    rotation = cRotation (continuous linear drift) + impulseRotation (damped snap)
 * 3. 2nd-Order Damped Harmonic Oscillator (Spring Math):
 *    stiffness = 180, dampingRatio = 0.6, morphScale = 0.14
 */
export const ExpressiveLoadingIndicator = React.memo(function ExpressiveLoadingIndicator({
  size = 38,
  color,
  containsIcon = false,
  icon,
  style,
  accessibilityLabel = 'Loading indicator',
  testID,
}: ExpressiveLoadingIndicatorProps) {
  const { colors } = useAppTheme();
  const fillColor = color || colors.primary;

  const shapeList = containsIcon ? SHAPES_ICON_MODE : SHAPES_STANDARD;

  // State indexes
  const fromIndex = useSharedValue(0);
  const toIndex = useSharedValue(1);

  // 1. Continuous Base Rotation (4666ms cycle, 0 -> 360 deg)
  const continuousRotation = useSharedValue(0);

  // 2. Harmonic Oscillator Shared Values
  const springTime = useSharedValue(0);
  const settledRotation = useSharedValue(0);
  const impulseRotation = useSharedValue(0);
  const morphProgress = useSharedValue(0);
  const dynamicScale = useSharedValue(1);

  // Harmonic constants: wn = sqrt(180) ≈ 13.416, zeta = 0.6, wd = wn * sqrt(1 - 0.36) ≈ 10.733
  const wn = 13.4164;
  const zeta = 0.6;
  const wd = 10.7331;
  const springMaxVelocity = 10.0;
  const morphScale = 0.14; // 14% elastic squish

  useEffect(() => {
    // Continuous drift rotation: 0 -> 360 over 4666ms
    continuousRotation.value = withRepeat(
      withTiming(360, {
        duration: 4666,
        easing: Easing.linear,
      }),
      -1,
      false
    );

    // Cadence timer: advance shape every 650ms
    const interval = setInterval(() => {
      // Accumulate previous +60 deg into settled rotation
      settledRotation.value += 60;
      // Advance shape index
      fromIndex.value = toIndex.value;
      toIndex.value = (toIndex.value + 1) % shapeList.length;
      // Reset spring time
      springTime.value = 0;
    }, 650);

    return () => clearInterval(interval);
  }, [shapeList.length, continuousRotation, fromIndex, toIndex, settledRotation, springTime]);

  // Analytical 2nd-Order Damped Spring Engine running per-frame on UI thread
  useFrameCallback(frameInfo => {
    'worklet';
    if (!frameInfo.timeSincePreviousFrame) return;

    // Increment spring elapsed time (in seconds)
    springTime.value += frameInfo.timeSincePreviousFrame / 1000;
    const t = springTime.value;

    if (t < 0.65) {
      // Analytical 2nd-Order Harmonic Position & Velocity
      const expTerm = Math.exp(-zeta * wn * t);
      const cosTerm = Math.cos(wd * t);
      const sinTerm = Math.sin(wd * t);

      // pos(t) = 1 - e^(-zeta*wn*t) * (cos(wd*t) + (zeta*wn/wd)*sin(wd*t))
      const pos = 1 - expTerm * (cosTerm + ((zeta * wn) / wd) * sinTerm);
      // vel(t) = e^(-zeta*wn*t) * (wn^2 / wd) * sin(wd*t)
      const vel = expTerm * ((wn * wn) / wd) * sinTerm;

      // 1. Clamped Morph Vector Progress (0 to 1, no self-intersection)
      morphProgress.value = Math.min(1, Math.max(0, pos));

      // 2. Elastic Jelly Scale: 1 + (vel * morphScale / springMaxVelocity)
      dynamicScale.value = 1 + (vel * morphScale) / springMaxVelocity;

      // 3. Dynamic Impulse Rotation (+60 deg snap)
      impulseRotation.value = pos * 60;
    } else {
      morphProgress.value = 1;
      dynamicScale.value = 1;
      impulseRotation.value = 60;
    }
  });

  // Interpolated SVG Path
  const currentPath = useMemo(() => {
    const fromVertices = SHAPE_VERTICES_CACHE[shapeList[0]];
    const toVertices = SHAPE_VERTICES_CACHE[shapeList[1]];
    const progress = morphProgress.value;

    const interpolated: [number, number][] = [];
    for (let i = 0; i < NUM_POINTS; i++) {
      const x = fromVertices[i][0] + (toVertices[i][0] - fromVertices[i][0]) * progress;
      const y = fromVertices[i][1] + (toVertices[i][1] - fromVertices[i][1]) * progress;
      interpolated.push([x, y]);
    }
    return verticesToSvgPath(interpolated);
  }, [shapeList, morphProgress.value]);

  // Dual-Layer Composite Rotation & Elastic Jelly Transform
  const animatedContainerStyle = useAnimatedStyle(() => {
    const totalRotation =
      continuousRotation.value + settledRotation.value + impulseRotation.value;

    return {
      transform: [
        { rotate: `${totalRotation}deg` },
        { scale: dynamicScale.value },
      ],
    };
  });

  const scaleFactor = size / 38;

  return (
    <View
      style={[
        styles.wrapper,
        { width: size, height: size },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Animated.View
        style={[
          styles.animContainer,
          { width: size, height: size },
          animatedContainerStyle,
        ]}
      >
        <Svg
          width={size}
          height={size}
          viewBox="0 0 38 38"
          style={StyleSheet.absoluteFillObject}
        >
          <Path d={currentPath} fill={fillColor} />
        </Svg>
      </Animated.View>

      {/* Optional Housed Centered Icon */}
      {containsIcon && icon ? (
        <View style={styles.iconSlot}>{icon}</View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  animContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlot: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
