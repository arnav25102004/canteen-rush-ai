import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Button as PaperButton } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { AppButtonProps, ButtonSize, ButtonVariant } from './Button.types';
import { TypographyTokens } from '../../tokens/typography';
import { MotionTokens } from '../../tokens/motion';
import { ShapeTokens } from '../../tokens/shapes';
import { useAppTheme } from '../../theme/ThemeProvider';

const SIZE_CONFIG: Record<
  ButtonSize,
  {
    height: number;
    paddingHorizontal: number;
    fontSize: number;
    lineHeight: number;
    defaultRadius: number;
    morphedRadius: number;
  }
> = {
  small: {
    height: 38,
    paddingHorizontal: 16,
    fontSize: TypographyTokens.labelMedium.fontSize,
    lineHeight: TypographyTokens.labelMedium.lineHeight,
    defaultRadius: 19,
    morphedRadius: 10,
  },
  medium: {
    height: 48,
    paddingHorizontal: 22,
    fontSize: TypographyTokens.labelLarge.fontSize,
    lineHeight: TypographyTokens.labelLarge.lineHeight,
    defaultRadius: 24,
    morphedRadius: 14,
  },
  large: {
    height: 56,
    paddingHorizontal: 28,
    fontSize: TypographyTokens.titleMedium.fontSize,
    lineHeight: TypographyTokens.titleMedium.lineHeight,
    defaultRadius: 28,
    morphedRadius: 16,
  },
};

export const Button = React.memo(function Button({
  label,
  onPress,
  variant = 'filled',
  size = 'medium',
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  fullWidth = false,
  morphOnPress = true,
  rippleColor,
  style,
  labelStyle,
  accessibilityLabel,
  accessibilityHint,
}: AppButtonProps) {
  const { colors, isDark } = useAppTheme();
  const config = SIZE_CONFIG[size];

  // Reanimated Spring-Physics values running on UI Thread
  const scale = useSharedValue(1);
  const cornerRadius = useSharedValue(config.defaultRadius);

  const modeMap: Record<
    ButtonVariant,
    'contained' | 'contained-tonal' | 'elevated' | 'outlined' | 'text'
  > = {
    filled: 'contained',
    tonal: 'contained-tonal',
    elevated: 'elevated',
    outlined: 'outlined',
    text: 'text',
  };

  const defaultRippleColor = useMemo(() => {
    if (rippleColor) return rippleColor;
    if (variant === 'filled') {
      return isDark ? 'rgba(0, 0, 0, 0.20)' : 'rgba(255, 255, 255, 0.24)';
    }
    return isDark ? 'rgba(255, 182, 139, 0.16)' : 'rgba(224, 109, 20, 0.16)';
  }, [rippleColor, variant, isDark]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
      borderRadius: cornerRadius.value,
    };
  });

  const handlePressIn = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Expressive Spatial Spring: Dynamic Compression + Shape Morphing
    scale.value = withSpring(0.96, MotionTokens.spatial.fast);
    if (morphOnPress) {
      cornerRadius.value = withSpring(
        config.morphedRadius,
        MotionTokens.spatial.fast
      );
    }
  };

  const handlePressOut = () => {
    if (disabled || loading) return;
    // Spring overshoot back to pill
    scale.value = withSpring(1.0, MotionTokens.spatial.default);
    if (morphOnPress) {
      cornerRadius.value = withSpring(
        config.defaultRadius,
        MotionTokens.spatial.default
      );
    }
  };

  const renderContent = () => {
    if (!trailingIcon) return label;
    return (
      <View style={styles.trailingContainer}>
        {typeof label === 'string' ? label : null}
        <View style={styles.trailingIconGap}>{trailingIcon}</View>
      </View>
    );
  };

  return (
    <Animated.View
      style={[
        {
          alignSelf: fullWidth ? 'stretch' : 'auto',
          overflow: 'hidden',
        },
        animatedStyle,
        style,
      ]}
    >
      <PaperButton
        mode={modeMap[variant] || 'contained'}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        rippleColor={defaultRippleColor}
        icon={typeof icon === 'string' ? icon : undefined}
        loading={loading}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        style={[
          {
            minHeight: config.height,
            justifyContent: 'center',
            borderRadius: config.defaultRadius,
          },
        ]}
        contentStyle={[
          {
            height: config.height,
            paddingHorizontal: config.paddingHorizontal,
          },
        ]}
        labelStyle={[
          {
            fontSize: config.fontSize,
            lineHeight: config.lineHeight,
            fontWeight: '700',
            letterSpacing: 0.2,
          },
          labelStyle,
        ]}
      >
        {renderContent()}
      </PaperButton>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  trailingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailingIconGap: {
    marginLeft: 8,
  },
});
