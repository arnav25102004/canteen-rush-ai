import React, { useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { ExpressiveSwitchProps } from './Switch.types';
import { useAppTheme } from '../../theme/ThemeProvider';
import { MotionTokens } from '../../tokens/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Material 3 Expressive Switch
 * 
 * Features:
 * 1. Track Geometry: Stadium pill (height: 32, width: 54 -> 1.7 ratio), 3px padding
 * 2. Elastic Thumb: Circular (26px) -> horizontally stretches +20% (31.2px) on press
 * 3. Icon Transition: Cross-dissolve + scale morph between 'check' (✓) and 'close' (✕) or 'minus' (—)
 * 4. State Layer Overlay: 10% opacity overlay on press
 * 5. M3 Expressive Dynamic Color Roles
 */
export const ExpressiveSwitch = React.memo(function ExpressiveSwitch({
  value,
  onValueChange,
  disabled = false,
  size = 32,
  accessibilityLabel = 'Toggle switch',
  accessibilityHint,
  style,
  testID,
}: ExpressiveSwitchProps) {
  const { colors, isDark } = useAppTheme();

  // Proportions
  const trackHeight = size;
  const trackWidth = Math.round(size * 1.7); // 54px
  const trackPadding = 3;
  const thumbBaseSize = trackHeight - trackPadding * 2; // 26px
  const thumbStretchWidth = thumbBaseSize * 1.2; // 31.2px (+20% horizontal stretch)
  const maxTravel = trackWidth - trackPadding * 2 - thumbBaseSize; // 22px

  // Dynamic M3 Palette
  const palette = useMemo(() => {
    if (disabled) {
      return {
        trackOn: isDark ? 'rgba(241, 223, 216, 0.12)' : 'rgba(32, 26, 23, 0.12)',
        trackOff: isDark ? 'rgba(241, 223, 216, 0.08)' : 'rgba(32, 26, 23, 0.08)',
        thumb: isDark ? 'rgba(241, 223, 216, 0.38)' : 'rgba(32, 26, 23, 0.38)',
        iconStrokeOn: isDark ? 'rgba(24, 18, 16, 0.60)' : 'rgba(255, 248, 246, 0.60)',
        iconStrokeOff: isDark ? 'rgba(241, 223, 216, 0.60)' : 'rgba(32, 26, 23, 0.60)',
        stateLayer: 'transparent',
      };
    }

    return {
      trackOn: colors.primary,
      trackOff: colors.surfaceContainerHighest,
      thumbOn: colors.onPrimary,
      thumbOff: colors.outline,
      iconStrokeOn: colors.primary,
      iconStrokeOff: colors.surfaceContainerHighest,
      stateLayerOn: colors.primary,
      stateLayerOff: colors.onSurface,
    };
  }, [disabled, colors, isDark]);

  // Shared Values on UI Thread
  const progress = useSharedValue(value ? 1 : 0);
  const pressProgress = useSharedValue(0);

  React.useEffect(() => {
    progress.value = withSpring(value ? 1 : 0, MotionTokens.spatial.fast);
  }, [value, progress]);

  // Touch handlers
  const handlePressIn = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pressProgress.value = withSpring(1, MotionTokens.spatial.fast);
  }, [disabled, pressProgress]);

  const handlePressOut = useCallback(() => {
    if (disabled) return;
    pressProgress.value = withSpring(0, MotionTokens.spatial.default);
  }, [disabled, pressProgress]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    onValueChange?.(!value);
  }, [disabled, onValueChange, value]);

  // Track color animation
  const animatedTrackStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1],
      [palette.trackOff, palette.trackOn]
    );
    return { backgroundColor };
  });

  // Elastic Thumb horizontal travel + stretch animation
  const animatedThumbStyle = useAnimatedStyle(() => {
    const translateX = progress.value * maxTravel;
    const currentWidth =
      thumbBaseSize + pressProgress.value * (thumbStretchWidth - thumbBaseSize);

    const offThumb = palette.thumbOff || palette.thumb || '#FFFFFF';
    const onThumb = palette.thumbOn || palette.thumb || '#FFFFFF';
    const backgroundColor = interpolateColor(
      progress.value,
      [0, 1],
      [offThumb, onThumb]
    );

    return {
      transform: [{ translateX }],
      width: currentWidth,
      backgroundColor,
    };
  });

  // Active Icon (Checkmark) Scale & Opacity
  const checkIconAnimatedStyle = useAnimatedStyle(() => {
    // When pressed, checkmark collapses slightly
    const scale = progress.value * (1 - pressProgress.value * 0.2);
    return {
      opacity: progress.value,
      transform: [{ scale }],
    };
  });

  // Inactive Icon (Close / Minus) Scale & Opacity
  const closeIconAnimatedStyle = useAnimatedStyle(() => {
    const scale = (1 - progress.value) * (1 - pressProgress.value * 0.2);
    return {
      opacity: 1 - progress.value,
      transform: [{ scale }],
    };
  });

  // Dynamic Icon Color
  const iconColor = value
    ? (palette.iconStrokeOn || palette.iconStrokeOn)
    : (palette.iconStrokeOff || palette.iconStrokeOff);

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={[
        styles.track,
        {
          width: trackWidth,
          height: trackHeight,
          borderRadius: 9999,
          padding: trackPadding,
        },
        animatedTrackStyle,
        disabled && styles.disabledTrack,
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          {
            height: thumbBaseSize,
            borderRadius: thumbBaseSize / 2,
          },
          animatedThumbStyle,
        ]}
      >
        {/* Layer 1: Checkmark Icon (Rendered for Active State) */}
        <Animated.View style={[styles.iconContainer, checkIconAnimatedStyle]}>
          <MaterialCommunityIcons
            name="check"
            size={16}
            color={palette.iconStrokeOn}
          />
        </Animated.View>

        {/* Layer 2: Close / Minus Icon (Rendered for Inactive State) */}
        <Animated.View style={[styles.iconContainer, closeIconAnimatedStyle]}>
          <MaterialCommunityIcons
            name="close"
            size={14}
            color={palette.iconStrokeOff}
          />
        </Animated.View>
      </Animated.View>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  track: {
    justifyContent: 'center',
    overflow: 'hidden',
  },
  disabledTrack: {
    opacity: 0.65,
  },
  thumb: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  iconContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
  },
});
