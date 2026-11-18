import React, { useRef, useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  Text,
  GestureResponderEvent,
  Platform,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
  interpolateColor,
} from 'react-native-reanimated';
import { ExpressiveCheckboxProps } from './Checkbox.types';
import { useTheme } from '../../theme/ThemeProvider';
import { MotionTokens } from '../../tokens/motion';
import { ExpressiveRipple } from '../Ripple/ExpressiveRipple';
import { ExpressiveRippleHandle } from '../Ripple/Ripple.types';

/**
 * Material 3 Expressive Checkbox (Android 15 Specification):
 * 1. 20x20dp container box with rounded squircle corners (radius 6dp) inside a 48x48dp target
 * 2. Spatial spring overshoot check bounce (Spring.StiffnessMediumLow / spatial.fast)
 * 3. Dynamic corner morph (radius morphs from 6dp resting to 4dp on press)
 * 4. Micro-press squish (0.92x scale on touch down)
 * 5. Integrated Euclidean state layer ripple
 */
export const ExpressiveCheckbox: React.FC<ExpressiveCheckboxProps> = React.memo(
  function ExpressiveCheckbox({
    checked,
    onCheckedChange,
    label,
    disabled = false,
    error = false,
    style,
    labelStyle,
    accessibilityLabel,
    testID,
  }) {
    const { colors } = useTheme();
    const rippleRef = useRef<ExpressiveRippleHandle>(null);

    // Spring Motion Shared Values
    const checkAnim = useSharedValue(checked ? 1 : 0);
    const pressAnim = useSharedValue(0);

    useEffect(() => {
      // Spatial spring with playful overshoot bounce into place
      checkAnim.value = withSpring(checked ? 1 : 0, MotionTokens.spatial.fast);
    }, [checked]);

    const handlePressIn = (e: GestureResponderEvent) => {
      if (disabled) return;
      pressAnim.value = withSpring(1, MotionTokens.spatial.fast);
      rippleRef.current?.onPressIn(
        e.nativeEvent.locationX,
        e.nativeEvent.locationY
      );
    };

    const handlePressOut = () => {
      if (disabled) return;
      pressAnim.value = withSpring(0, MotionTokens.spatial.fast);
      rippleRef.current?.onPressOut();
    };

    const handlePress = () => {
      if (disabled) return;
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      }
      onCheckedChange(!checked);
    };

    // Color tokens
    const primaryColor = error ? colors.error : colors.primary;
    const onPrimaryColor = error ? colors.onError : colors.onPrimary;
    const outlineColor = error ? colors.error : colors.outline;

    // Checkbox container animated appearance
    const animatedBoxStyle = useAnimatedStyle(() => {
      const scale = interpolate(
        pressAnim.value,
        [0, 1],
        [1, 0.92],
        Extrapolation.CLAMP
      );
      // Dynamic corner radius morphing on press
      const borderRadius = interpolate(
        pressAnim.value,
        [0, 1],
        [6, 4],
        Extrapolation.CLAMP
      );

      const backgroundColor = interpolateColor(
        checkAnim.value,
        [0, 1],
        ['transparent', primaryColor]
      );

      const borderColor = interpolateColor(
        checkAnim.value,
        [0, 1],
        [outlineColor, primaryColor]
      );

      return {
        borderRadius,
        backgroundColor,
        borderColor,
        transform: [{ scale }],
      };
    });

    // Checkmark check bounce & morph
    const animatedCheckStyle = useAnimatedStyle(() => {
      // Overshoot scale bounce on check
      const scale = interpolate(
        checkAnim.value,
        [0, 0.6, 1],
        [0, 1.25, 1],
        Extrapolation.CLAMP
      );
      const opacity = interpolate(
        checkAnim.value,
        [0, 0.3, 1],
        [0, 1, 1],
        Extrapolation.CLAMP
      );

      return {
        opacity,
        transform: [{ scale }],
      };
    });

    return (
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessible
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={accessibilityLabel || label || 'Checkbox'}
        testID={testID}
        style={[styles.root, disabled && styles.disabled, style]}
      >
        {/* 48x48dp Touch Target & State Ripple Anchor */}
        <View style={styles.touchAnchor}>
          {/* Contact-anchored Euclidean Ripple */}
          <ExpressiveRipple
            ref={rippleRef}
            width={40}
            height={40}
            borderRadius={20}
            color={checked ? primaryColor : colors.onSurface}
            maxOpacity={0.14}
          />

          {/* 20x20dp M3 Expressive Box Container */}
          <Animated.View style={[styles.box, animatedBoxStyle]}>
            <Animated.View style={animatedCheckStyle}>
              <MaterialCommunityIcons
                name="check-bold"
                size={14}
                color={onPrimaryColor}
              />
            </Animated.View>
          </Animated.View>
        </View>

        {/* Optional Label */}
        {label ? (
          <Text
            style={[
              styles.label,
              { color: disabled ? colors.outline : colors.onSurface },
              labelStyle,
            ]}
          >
            {label}
          </Text>
        ) : null}
      </Pressable>
    );
  }
);

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  disabled: {
    opacity: 0.38,
  },
  touchAnchor: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  box: {
    width: 20,
    height: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.1,
    marginLeft: 4,
  },
});
