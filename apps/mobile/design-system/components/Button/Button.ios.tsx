import React, { useMemo } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AppButtonProps, ButtonSize } from './Button.types';
import { TypographyTokens } from '../../tokens/typography';
import { MotionTokens } from '../../tokens/motion';
import { useAppTheme } from '../../theme/ThemeProvider';

const SIZE_CONFIG: Record<
  ButtonSize,
  {
    minHeight: number;
    paddingHorizontal: number;
    fontSize: number;
    defaultRadius: number;
    morphedRadius: number;
    iconGap: number;
  }
> = {
  small: {
    minHeight: 38,
    paddingHorizontal: 16,
    fontSize: TypographyTokens.labelMedium.fontSize,
    defaultRadius: 19,
    morphedRadius: 10,
    iconGap: 6,
  },
  medium: {
    minHeight: 48,
    paddingHorizontal: 22,
    fontSize: TypographyTokens.labelLarge.fontSize,
    defaultRadius: 24,
    morphedRadius: 14,
    iconGap: 8,
  },
  large: {
    minHeight: 56,
    paddingHorizontal: 28,
    fontSize: TypographyTokens.titleMedium.fontSize,
    defaultRadius: 28,
    morphedRadius: 16,
    iconGap: 10,
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
  style,
  labelStyle,
  accessibilityLabel,
  accessibilityHint,
}: AppButtonProps) {
  const { cupertinoColors, isDark } = useAppTheme();
  const config = SIZE_CONFIG[size];

  const scale = useSharedValue(1);
  const cornerRadius = useSharedValue(config.defaultRadius);

  const isFilled = variant === 'filled';
  const isTonal = variant === 'tonal';
  const isElevated = variant === 'elevated';
  const isOutlined = variant === 'outlined';
  const isText = variant === 'text';

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderRadius: cornerRadius.value,
  }));

  const handlePressIn = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scale.value = withSpring(0.96, MotionTokens.spatial.fast);
    if (morphOnPress) {
      cornerRadius.value = withSpring(config.morphedRadius, MotionTokens.spatial.fast);
    }
  };

  const handlePressOut = () => {
    if (disabled || loading) return;
    scale.value = withSpring(1.0, MotionTokens.spatial.default);
    if (morphOnPress) {
      cornerRadius.value = withSpring(config.defaultRadius, MotionTokens.spatial.default);
    }
  };

  const getSpinnerColor = () => {
    if (isFilled) return cupertinoColors.onPrimary;
    return cupertinoColors.primary;
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
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        style={[
          styles.base,
          {
            minHeight: config.minHeight,
            paddingHorizontal: isText ? 12 : config.paddingHorizontal,
            backgroundColor: isFilled
              ? cupertinoColors.primary
              : isTonal
              ? cupertinoColors.secondarySystemBackground
              : isElevated
              ? cupertinoColors.secondaryGroupedBackground
              : 'transparent',
            borderColor: isOutlined ? cupertinoColors.primary : 'transparent',
            borderWidth: isOutlined ? 1.5 : 0,
          },
          isElevated && styles.elevated,
          disabled && {
            backgroundColor: cupertinoColors.systemGray5,
            borderColor: 'transparent',
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={getSpinnerColor()} size="small" />
        ) : (
          <View style={styles.contentRow}>
            {icon && typeof icon !== 'string' ? (
              <View style={{ marginRight: config.iconGap }}>{icon}</View>
            ) : null}

            <Text
              style={[
                styles.text,
                {
                  fontSize: config.fontSize,
                  color: disabled
                    ? cupertinoColors.systemGray
                    : isFilled
                    ? cupertinoColors.onPrimary
                    : cupertinoColors.primary,
                },
                labelStyle,
              ]}
            >
              {label}
            </Text>

            {trailingIcon ? (
              <View style={{ marginLeft: config.iconGap }}>{trailingIcon}</View>
            ) : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  text: {
    fontWeight: '700',
    letterSpacing: -0.15,
  },
});
