import React, { useMemo, useCallback, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  GestureResponderEvent,
  Pressable,
  LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ExpressiveButtonProps } from './ExpressiveButton.types';
import { useAppTheme } from '../../theme/ThemeProvider';
import { MotionTokens } from '../../tokens/motion';
import { TypographyTokens } from '../../tokens/typography';
import { ExpressiveRipple, ExpressiveRippleHandle } from '../Ripple';
import { ExpressiveLoadingIndicator } from '../LoadingIndicator';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const RADIUS_MAP = {
  resting: 24,
  toggled: 14,
  pressed: 8,
};

export const ExpressiveButton = React.memo(function ExpressiveButton({
  label,
  icon,
  trailingIcon,
  onPress,
  variant = 'filled',
  isToggle = false,
  isSelected = false,
  onToggleChange,
  radiusMorph = true,
  shapeMorph = false,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  labelStyle,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ExpressiveButtonProps) {
  const { colors, isDark } = useAppTheme();
  const isIconButton = !label && Boolean(icon);
  const rippleRef = useRef<ExpressiveRippleHandle>(null);

  // Dynamic Layout Measurement for Euclidean Math
  const [layout, setLayout] = useState({ width: 120, height: 48 });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayout({ width, height });
    }
  }, []);

  // Dynamic M3 Palette
  const colorScheme = useMemo(() => {
    if (disabled) {
      return {
        container: isDark ? 'rgba(241, 223, 216, 0.10)' : 'rgba(32, 26, 23, 0.10)',
        content: isDark ? 'rgba(241, 223, 216, 0.38)' : 'rgba(32, 26, 23, 0.38)',
        stateLayer: '#FFFFFF',
      };
    }

    if (isToggle && !isSelected) {
      return {
        container: isDark ? colors.surfaceContainer : colors.surfaceContainerHigh,
        content: colors.onSurface,
        stateLayer: colors.onSurface,
      };
    }

    switch (variant) {
      case 'filled':
        return {
          container: colors.primary,
          content: colors.onPrimary,
          stateLayer: colors.onPrimary,
        };
      case 'tonal':
        return {
          container: colors.secondaryContainer,
          content: colors.onSecondaryContainer,
          stateLayer: colors.onSecondaryContainer,
        };
      case 'text':
      default:
        return {
          container: 'transparent',
          content: colors.primary,
          stateLayer: colors.primary,
        };
    }
  }, [variant, isToggle, isSelected, disabled, colors, isDark]);

  // Pure Corner Radius Morphing
  const initialRadius = isToggle && isSelected ? RADIUS_MAP.toggled : RADIUS_MAP.resting;
  const cornerRadius = useSharedValue(initialRadius);

  React.useEffect(() => {
    if (isToggle) {
      const targetRadius = isSelected ? RADIUS_MAP.toggled : RADIUS_MAP.resting;
      cornerRadius.value = withSpring(targetRadius, MotionTokens.spatial.default);
    }
  }, [isToggle, isSelected, cornerRadius]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    borderRadius: radiusMorph ? cornerRadius.value : initialRadius,
  }));

  const pressableAnimatedStyle = useAnimatedStyle(() => ({
    borderRadius: radiusMorph ? cornerRadius.value : initialRadius,
  }));

  // Gesture Handlers with Euclidean Contact Coordinates
  const handlePressIn = useCallback((e: GestureResponderEvent) => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { locationX, locationY } = e.nativeEvent;
    // Trigger Euclidean-calculated radial gradient wave from touch coordinate
    rippleRef.current?.onPressIn(locationX, locationY);

    if (radiusMorph) {
      cornerRadius.value = withSpring(RADIUS_MAP.pressed, MotionTokens.spatial.fast);
    }
  }, [disabled, loading, radiusMorph, cornerRadius]);

  const handlePressOut = useCallback(() => {
    if (disabled || loading) return;
    rippleRef.current?.onPressOut();

    if (radiusMorph) {
      const targetRadius = isToggle && isSelected ? RADIUS_MAP.toggled : RADIUS_MAP.resting;
      cornerRadius.value = withSpring(targetRadius, MotionTokens.spatial.default);
    }
  }, [disabled, loading, radiusMorph, isToggle, isSelected, cornerRadius]);

  const handlePress = useCallback((e: GestureResponderEvent) => {
    if (disabled || loading) return;
    if (isToggle && onToggleChange) {
      onToggleChange(!isSelected);
    }
    onPress?.(e);
  }, [disabled, loading, isToggle, isSelected, onToggleChange, onPress]);

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.outerContainer,
        {
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        containerAnimatedStyle,
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
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[
          styles.pressableContainer,
          isIconButton ? styles.iconButtonShape : styles.buttonShape,
          {
            backgroundColor: colorScheme.container,
          },
          pressableAnimatedStyle,
        ]}
      >
        {/* Caelestia Shell Dynamic Euclidean Ripple Engine */}
        <ExpressiveRipple
          ref={rippleRef}
          width={layout.width}
          height={layout.height}
          borderRadius={cornerRadius}
          color={colorScheme.stateLayer}
          maxOpacity={0.32}
        />

        {loading ? (
          <ExpressiveLoadingIndicator
            size={22}
            color={colorScheme.content}
          />
        ) : (
          <View style={styles.contentRow}>
            {icon ? (
              <View style={!isIconButton ? styles.leadingIconGap : undefined}>
                {icon}
              </View>
            ) : null}

            {label ? (
              <Text
                style={[
                  styles.label,
                  { color: colorScheme.content },
                  labelStyle,
                ]}
              >
                {label}
              </Text>
            ) : null}

            {trailingIcon ? (
              <View style={styles.trailingIconGap}>{trailingIcon}</View>
            ) : null}
          </View>
        )}
      </AnimatedPressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    overflow: 'hidden',
  },
  pressableContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  buttonShape: {
    height: 48,
    paddingHorizontal: 24,
  },
  iconButtonShape: {
    width: 48,
    height: 48,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  leadingIconGap: {
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trailingIconGap: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: TypographyTokens.labelLarge.fontSize,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
