import React, { useImperativeHandle, forwardRef, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { ExpressiveRippleProps, ExpressiveRippleHandle } from './Ripple.types';

/**
 * Material 3 Expressive Ripple (Caelestia Shell Architecture)
 * 
 * 1. Contact Coordinate Anchoring (pressX, pressY)
 * 2. Maximum Euclidean Distance Math:
 *    endRadius = sqrt(max(d1, d2, d3, d4)) * 1.3
 * 3. Two-Stage Lifecycle:
 *    - Guaranteed expansion to endRadius with M3 standard deceleration
 *    - Independent quadratic fade-out dissipation upon release
 * 4. Zero component-render .value access (fully UI-thread worklet driven)
 * 5. Static 8% hover state layer
 */
export const ExpressiveRipple = React.memo(
  forwardRef<ExpressiveRippleHandle, ExpressiveRippleProps>(function ExpressiveRipple(
    {
      width,
      height,
      borderRadius,
      color = '#FFFFFF',
      maxOpacity = 0.16,
      style,
    },
    ref
  ) {
    // Coordinate Anchoring
    const pressX = useSharedValue(width / 2);
    const pressY = useSharedValue(height / 2);

    // Dynamic Geometry Shared Values
    const circleRadius = useSharedValue(0);
    const waveOpacity = useSharedValue(0);
    const hoverOpacity = useSharedValue(0);

    // Maximum Euclidean distance calculation
    const calculateEndRadius = (px: number, py: number) => {
      'worklet';
      const w = width > 0 ? width : 300;
      const h = height > 0 ? height : 48;
      const d1 = px * px + py * py; // (0, 0)
      const d2 = (w - px) * (w - px) + py * py; // (width, 0)
      const d3 = px * px + (h - py) * (h - py); // (0, height)
      const d4 = (w - px) * (w - px) + (h - py) * (h - py); // (width, height)
      return Math.sqrt(Math.max(d1, d2, d3, d4)) * 1.4; // 40% buffer
    };

    useImperativeHandle(ref, () => ({
      onPressIn: (x: number, y: number) => {
        const defaultW = width > 0 ? width : 300;
        const defaultH = height > 0 ? height : 48;
        pressX.value = (typeof x === 'number' && x >= 0) ? x : defaultW / 2;
        pressY.value = (typeof y === 'number' && y >= 0) ? y : defaultH / 2;
        const endRad = calculateEndRadius(pressX.value, pressY.value);

        // Stage 1: Expansion with guaranteed run to end
        circleRadius.value = 0;
        waveOpacity.value = maxOpacity;

        circleRadius.value = withTiming(endRad, {
          duration: 400,
          easing: Easing.bezier(0.2, 0.0, 0, 1.0),
        });
      },

      onPressOut: () => {
        // Stage 2: Fade-out dissipation
        waveOpacity.value = withTiming(0, {
          duration: 320,
          easing: Easing.out(Easing.quad),
        });
      },

      onHoverIn: () => {
        hoverOpacity.value = withTiming(0.08, { duration: 150 });
      },

      onHoverOut: () => {
        hoverOpacity.value = withTiming(0, { duration: 150 });
      },
    }));

    const animatedHoverStyle = useAnimatedStyle(() => ({
      opacity: hoverOpacity.value,
    }));

    // Animated Circle Wavefront running entirely on UI thread
    const animatedWaveStyle = useAnimatedStyle(() => {
      const r = circleRadius.value;
      return {
        opacity: waveOpacity.value,
        left: pressX.value - r,
        top: pressY.value - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
      };
    });

    return (
      <View pointerEvents="none" style={[styles.container, style]}>
        {/* Static 8% Hover State Layer */}
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: color },
            animatedHoverStyle,
          ]}
        />

        {/* Dynamic Euclidean Expanding Wavefront */}
        <Animated.View
          style={[
            styles.wave,
            { backgroundColor: color },
            animatedWaveStyle,
          ]}
        />
      </View>
    );
  })
);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  wave: {
    position: 'absolute',
  },
});
