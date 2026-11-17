import React, { useMemo, useCallback, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  GestureResponderEvent,
  ActivityIndicator,
  LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { ExpressiveIconButtonProps } from './IconButton.types';
import { useAppTheme } from '../../theme/ThemeProvider';
import { MotionTokens } from '../../tokens/motion';
import { ExpressiveRipple, ExpressiveRippleHandle } from '../Ripple';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Material 3 Expressive Icon Button
 * 
 * 1. 1:1 Aspect Ratio Clamping (w === h).
 * 2. Even-Pixel Normalization to prevent sub-pixel raster jitter.
 * 3. Optical Baseline Offset (+1px) for dead-center alignment.
 * 4. Fill Morphing (toggle outline <-> solid fill).
 * 5. Full M3 Variant Color Roles (Filled, Tonal, Standard).
 * 6. Dynamic Corner-Radius Morphing & Contact-Anchored Ripple.
 */
export const ExpressiveIconButton = React.memo(function ExpressiveIconButton({
  icon,
  iconSize = 24,
  onPress,
  variant = 'standard',
  isToggle = false,
  isSelected = false,
  onToggleChange,
  disabled = false,
  loading = false,
  size = 48,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ExpressiveIconButtonProps) {
  const { colors, isDark } = useAppTheme();
  const rippleRef = useRef<ExpressiveRippleHandle>(null);

  // Even-Pixel Normalization
  const baseDim = size % 2 === 0 ? size : size + 1;
  const restingRadius = baseDim / 2; // Circular
  const toggledRadius = 14;          // M3 Expressive medium rounding
  const pressedRadius = 10;          // Small squircle compression

  const cornerRadius = useSharedValue(
    isToggle && isSelected ? toggledRadius : restingRadius
  );

  React.useEffect(() => {
    if (isToggle) {
      const targetRadius = isSelected ? toggledRadius : restingRadius;
      cornerRadius.value = withSpring(targetRadius, MotionTokens.spatial.default);
    }
  }, [isToggle, isSelected, restingRadius, toggledRadius, cornerRadius]);

  // Color Tokens Mapping
  const colorScheme = useMemo(() => {
    if (disabled) {
      return {
        container: variant === 'standard' ? 'transparent' : 'rgba(241, 223, 216, 0.12)',
        content: isDark ? 'rgba(241, 223, 216, 0.38)' : 'rgba(32, 26, 23, 0.38)',
        stateLayer: '#FFFFFF',
      };
    }

    if (variant === 'filled') {
      if (isToggle) {
        return {
          container: isSelected ? colors.primary : colors.surfaceContainer,
          content: isSelected ? colors.onPrimary : colors.onSurfaceVariant,
          stateLayer: isSelected ? colors.onPrimary : colors.onSurfaceVariant,
        };
      }
      return {
        container: colors.primary,
        content: colors.onPrimary,
        stateLayer: colors.onPrimary,
      };
    }

    if (variant === 'tonal') {
      if (isToggle) {
        return {
          container: isSelected ? colors.secondary : colors.secondaryContainer,
          content: isSelected ? colors.onSecondary : colors.onSecondaryContainer,
          stateLayer: isSelected ? colors.onSecondary : colors.onSecondaryContainer,
        };
      }
      return {
        container: colors.secondaryContainer,
        content: colors.onSecondaryContainer,
        stateLayer: colors.onSecondaryContainer,
      };
    }

    // Standard / Text
    return {
      container: 'transparent',
      content: isToggle && isSelected ? colors.primary : colors.onSurfaceVariant,
      stateLayer: isToggle && isSelected ? colors.primary : colors.onSurfaceVariant,
    };
  }, [variant, isToggle, isSelected, disabled, colors, isDark]);

  const animatedStyle = useAnimatedStyle(() => ({
    borderRadius: cornerRadius.value,
  }));

  const handlePressIn = useCallback((e: GestureResponderEvent) => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { locationX, locationY } = e.nativeEvent;
    rippleRef.current?.onPressIn(locationX, locationY);
    cornerRadius.value = withSpring(pressedRadius, MotionTokens.spatial.fast);
  }, [disabled, loading, cornerRadius, pressedRadius]);

  const handlePressOut = useCallback(() => {
    if (disabled || loading) return;
    rippleRef.current?.onPressOut();
    const targetRadius = isToggle && isSelected ? toggledRadius : restingRadius;
    cornerRadius.value = withSpring(targetRadius, MotionTokens.spatial.default);
  }, [disabled, loading, isToggle, isSelected, toggledRadius, restingRadius, cornerRadius]);

  const handlePress = useCallback((e: GestureResponderEvent) => {
    if (disabled || loading) return;
    if (isToggle && onToggleChange) {
      onToggleChange(!isSelected);
    }
    onPress?.(e);
  }, [disabled, loading, isToggle, isSelected, onToggleChange, onPress]);

  // Optical Baseline Offset: +1px down
  const opticalCenterOffset = 1;

  // Variable Fill Icon Name Resolution:
  // e.g. 'heart-outline' <-> 'heart', 'bookmark-outline' <-> 'bookmark'
  const iconName = useMemo(() => {
    if (!isToggle) return icon;
    if (isSelected) {
      return icon.replace(/-outline$/, '');
    }
    return icon.endsWith('-outline') ? icon : `${icon}-outline`;
  }, [icon, isToggle, isSelected]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: baseDim,
          height: baseDim,
        },
        animatedStyle,
        style,
      ]}
    >
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        accessibilityRole={isToggle ? 'checkbox' : 'button'}
        accessibilityState={{
          disabled,
          busy: loading,
          selected: isToggle ? isSelected : undefined,
          checked: isToggle ? isSelected : undefined,
        }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[
          styles.pressable,
          {
            width: baseDim,
            height: baseDim,
            backgroundColor: colorScheme.container,
          },
          animatedStyle,
        ]}
      >
        <ExpressiveRipple
          ref={rippleRef}
          width={baseDim}
          height={baseDim}
          borderRadius={cornerRadius}
          color={colorScheme.stateLayer}
          maxOpacity={0.16}
        />

        {loading ? (
          <ActivityIndicator color={colorScheme.content} size="small" />
        ) : (
          <View style={[styles.iconWrapper, { transform: [{ translateY: opticalCenterOffset }] }]}>
            <MaterialCommunityIcons
              name={iconName as any}
              size={iconSize}
              color={colorScheme.content}
            />
          </View>
        )}
      </AnimatedPressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  pressable: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
