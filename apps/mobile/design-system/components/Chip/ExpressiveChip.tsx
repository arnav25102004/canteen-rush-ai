import React, { useRef, useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  Text,
  Image,
  GestureResponderEvent,
  Platform,
  ImageSourcePropType,
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
import { ExpressiveChipProps } from './Chip.types';
import { useTheme } from '../../theme/ThemeProvider';
import { MotionTokens } from '../../tokens/motion';
import { ExpressiveRipple } from '../Ripple/ExpressiveRipple';
import { ExpressiveRippleHandle } from '../Ripple/Ripple.types';

/**
 * Material 3 Expressive Chip Component:
 * Specifications matching material-web (<md-assist-chip>, <md-filter-chip>, <md-input-chip>, <md-suggestion-chip>):
 * - Standard Height: 32dp
 * - Corner Radius: 8dp (sys.shape.corner-small), morphs to 6dp on contact
 * - Contact-anchored Euclidean ripple
 * - Micro-press scale squish (0.96x)
 * - Morphing checkmark icon for filter chips
 * - 24dp circular avatar container for input chips
 * - Trailing 18dp remove icon with independent touch target
 * - Elevated variant using surfaceContainerLow elevation
 */
export const ExpressiveChip: React.FC<ExpressiveChipProps> = React.memo(
  function ExpressiveChip({
    label,
    type = 'assist',
    selected = false,
    onSelectedChange,
    onPress,
    elevated = false,
    removable = false,
    onRemove,
    removeOnly = false,
    icon,
    selectedIcon,
    avatar,
    disabled = false,
    style,
    labelStyle,
    accessibilityLabel,
    testID,
  }) {
    const { colors } = useTheme();
    const rippleRef = useRef<ExpressiveRippleHandle>(null);

    // Spring Motion Shared Values
    const selectAnim = useSharedValue(selected ? 1 : 0);
    const pressAnim = useSharedValue(0);

    useEffect(() => {
      selectAnim.value = withSpring(selected ? 1 : 0, MotionTokens.spatial.fast);
    }, [selected]);

    const handlePressIn = (e: GestureResponderEvent) => {
      if (disabled || removeOnly) return;
      pressAnim.value = withSpring(1, MotionTokens.spatial.fast);
      rippleRef.current?.onPressIn(
        e.nativeEvent.locationX,
        e.nativeEvent.locationY
      );
    };

    const handlePressOut = () => {
      if (disabled || removeOnly) return;
      pressAnim.value = withSpring(0, MotionTokens.spatial.fast);
      rippleRef.current?.onPressOut();
    };

    const handlePress = (e?: GestureResponderEvent) => {
      if (disabled || removeOnly) return;

      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      }

      if (type === 'filter') {
        onSelectedChange?.(!selected);
      }
      onPress?.(e);
    };

    const handleRemove = (e: GestureResponderEvent) => {
      e.stopPropagation();
      if (disabled) return;
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      }
      onRemove?.();
    };

    // Color definitions per M3 token spec
    const outlineColor = colors.outline;
    const selectedContainerColor = colors.secondaryContainer;
    const unselectedContainerColor = elevated ? colors.surfaceContainerLow : 'transparent';
    const selectedTextColor = colors.onSecondaryContainer;
    const unselectedTextColor = colors.onSurface;

    // Animated container style
    const animatedContainerStyle = useAnimatedStyle(() => {
      const scale = interpolate(
        pressAnim.value,
        [0, 1],
        [1, 0.96],
        Extrapolation.CLAMP
      );
      // Subtle corner morph on press: 8dp -> 6dp
      const borderRadius = interpolate(
        pressAnim.value,
        [0, 1],
        [8, 6],
        Extrapolation.CLAMP
      );

      const backgroundColor = interpolateColor(
        selectAnim.value,
        [0, 1],
        [unselectedContainerColor, selectedContainerColor]
      );

      const borderColor = interpolateColor(
        selectAnim.value,
        [0, 1],
        [elevated ? 'transparent' : outlineColor, 'transparent']
      );

      return {
        borderRadius,
        backgroundColor,
        borderColor,
        transform: [{ scale }],
      };
    });

    // Checkmark scale animation (for selected filter chip)
    const animatedCheckStyle = useAnimatedStyle(() => {
      const scale = interpolate(
        selectAnim.value,
        [0, 0.6, 1],
        [0, 1.2, 1],
        Extrapolation.CLAMP
      );
      const opacity = interpolate(
        selectAnim.value,
        [0, 0.3, 1],
        [0, 1, 1],
        Extrapolation.CLAMP
      );
      const width = interpolate(
        selectAnim.value,
        [0, 1],
        [0, 18],
        Extrapolation.CLAMP
      );

      return {
        width,
        opacity,
        transform: [{ scale }],
      };
    });

    // Label color animation
    const animatedLabelStyle = useAnimatedStyle(() => {
      const color = interpolateColor(
        selectAnim.value,
        [0, 1],
        [unselectedTextColor, selectedTextColor]
      );
      return {
        color,
      };
    });

    // Render leading icon or avatar
    const renderLeading = () => {
      // 1. Avatar (for input chips)
      if (avatar) {
        const imageSource: ImageSourcePropType =
          typeof avatar === 'string' ? { uri: avatar } : avatar;
        return (
          <Image
            source={imageSource}
            style={styles.avatar}
            accessibilityLabel={`${label} avatar`}
          />
        );
      }

      // 2. Selected Filter Chip Checkmark
      if (type === 'filter') {
        return (
          <Animated.View style={[styles.checkContainer, animatedCheckStyle]}>
            {selectedIcon ? (
              typeof selectedIcon === 'string' ? (
                <MaterialCommunityIcons
                  name={selectedIcon as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={18}
                  color={selectedTextColor}
                />
              ) : (
                selectedIcon
              )
            ) : (
              <MaterialCommunityIcons
                name="check"
                size={18}
                color={selectedTextColor}
              />
            )}
          </Animated.View>
        );
      }

      // 3. Optional Leading Icon
      if (icon) {
        if (typeof icon === 'string') {
          return (
            <MaterialCommunityIcons
              name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={18}
              color={selected ? selectedTextColor : colors.primary}
              style={styles.leadingIcon}
            />
          );
        }
        return <View style={styles.leadingIcon}>{icon}</View>;
      }

      return null;
    };

    // Render trailing action (removable close icon)
    const renderTrailing = () => {
      if (!removable && !onRemove) return null;

      return (
        <Pressable
          onPress={handleRemove}
          hitSlop={8}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          style={styles.removeButton}
        >
          <MaterialCommunityIcons
            name="close-circle"
            size={18}
            color={selected ? selectedTextColor : colors.onSurfaceVariant}
          />
        </Pressable>
      );
    };

    return (
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessible
        accessibilityRole={type === 'filter' ? 'checkbox' : 'button'}
        accessibilityState={{
          selected: type === 'filter' ? selected : undefined,
          disabled,
        }}
        accessibilityLabel={accessibilityLabel || label}
        testID={testID}
        style={[styles.root, disabled && styles.disabled, style]}
      >
        <Animated.View
          style={[
            styles.container,
            elevated && styles.elevatedContainer,
            animatedContainerStyle,
          ]}
        >
          {/* Euclidean Contact-anchored State Layer Ripple */}
          <ExpressiveRipple
            ref={rippleRef}
            width={120}
            height={32}
            borderRadius={8}
            color={selected ? selectedTextColor : colors.onSurface}
            maxOpacity={0.12}
          />

          {/* Leading Section */}
          {renderLeading()}

          {/* Label Text */}
          <Animated.Text
            style={[styles.label, animatedLabelStyle, labelStyle]}
            numberOfLines={1}
          >
            {label}
          </Animated.Text>

          {/* Trailing Section */}
          {renderTrailing()}
        </Animated.View>
      </Pressable>
    );
  }
);

const styles = StyleSheet.create({
  root: {
    minHeight: 32,
    alignSelf: 'flex-start',
  },
  container: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  elevatedContainer: {
    borderWidth: 0,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  disabled: {
    opacity: 0.38,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: -4,
    marginRight: 6,
  },
  checkContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 4,
  },
  leadingIcon: {
    marginRight: 6,
    marginLeft: -2,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.1,
    includeFontPadding: false,
  },
  removeButton: {
    marginLeft: 6,
    marginRight: -4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
