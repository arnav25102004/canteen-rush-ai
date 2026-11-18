import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  GestureResponderEvent,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { MotionTokens } from '../../tokens/motion';
import { ExpressiveRipple } from '../Ripple/ExpressiveRipple';
import { ExpressiveRippleHandle } from '../Ripple/Ripple.types';
import { ExpressiveNavigationBarProps } from './NavigationBar.types';

// Default route icons mapped to Material 3 Expressive (outline & filled pairs)
const DEFAULT_ROUTE_ICONS: Record<
  string,
  { label: string; icon: string; activeIcon: string }
> = {
  home: {
    label: 'Canteens',
    icon: 'storefront-outline',
    activeIcon: 'storefront',
  },
  orders: {
    label: 'Orders',
    icon: 'clipboard-text-outline',
    activeIcon: 'clipboard-text',
  },
  rewards: {
    label: 'Rewards',
    icon: 'star-outline',
    activeIcon: 'star',
  },
  profile: {
    label: 'Profile',
    icon: 'account-outline',
    activeIcon: 'account',
  },
};

interface NavigationBarItemProps {
  routeKey: string;
  routeName: string;
  label: string;
  iconName: string;
  activeIconName: string;
  badge?: string | number | boolean;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const NavigationBarItem = React.memo(function NavigationBarItem({
  routeKey,
  label,
  iconName,
  activeIconName,
  badge,
  isFocused,
  onPress,
  onLongPress,
}: NavigationBarItemProps) {
  const { colors } = useTheme();
  const rippleRef = useRef<ExpressiveRippleHandle>(null);

  // M3 Expressive Motion Springs
  const focusAnim = useSharedValue(isFocused ? 1 : 0);
  const pressAnim = useSharedValue(0);

  useEffect(() => {
    // Spatial spring for active indicator shape & transition
    focusAnim.value = withSpring(isFocused ? 1 : 0, MotionTokens.spatial.fast);
  }, [isFocused]);

  const handlePressIn = (e: GestureResponderEvent) => {
    pressAnim.value = withSpring(1, MotionTokens.spatial.fast);
    rippleRef.current?.onPressIn(
      e.nativeEvent.locationX,
      e.nativeEvent.locationY
    );
  };

  const handlePressOut = () => {
    pressAnim.value = withSpring(0, MotionTokens.spatial.fast);
    rippleRef.current?.onPressOut();
  };

  const handlePress = () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
    onPress();
  };

  // Active Pill Indicator Animation (M3 Expressive: 56dp x 32dp pill)
  const pillStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      focusAnim.value,
      [0, 1],
      [0.6, 1],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      focusAnim.value,
      [0, 1],
      [0, 1],
      Extrapolation.CLAMP
    );
    const pressScale = interpolate(
      pressAnim.value,
      [0, 1],
      [1, 0.94],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ scale: scale * pressScale }],
    };
  });

  // Icon bounce & scale animation
  const iconContainerStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      pressAnim.value,
      [0, 1],
      [1, 0.9],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
    };
  });

  // Label text animation (M3 Expressive: unselected medium opacity, selected primary/onSurface)
  const labelStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      focusAnim.value,
      [0, 1],
      [0.72, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity,
    };
  });

  const activeColor = colors.primary;
  const inactiveColor = colors.onSurfaceVariant;
  const indicatorColor = colors.secondaryContainer;
  const onIndicatorColor = colors.onSecondaryContainer;

  return (
    <Pressable
      key={routeKey}
      onPress={handlePress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
      style={styles.itemContainer}
    >
      {/* Pill Target Wrapper (56 x 32dp Touch & Pill Anchor) */}
      <View style={styles.pillWrapper}>
        {/* Animated Active Indicator Pill */}
        <Animated.View
          style={[
            styles.activeIndicatorPill,
            { backgroundColor: indicatorColor },
            pillStyle,
          ]}
        />

        {/* Contact-anchored M3 Expressive Euclidean Ripple */}
        <ExpressiveRipple
          ref={rippleRef}
          width={56}
          height={32}
          borderRadius={16}
          color={isFocused ? onIndicatorColor : activeColor}
          maxOpacity={0.16}
        />

        {/* Morphing Icon Container */}
        <Animated.View style={[styles.iconWrapper, iconContainerStyle]}>
          <MaterialCommunityIcons
            name={
              (isFocused ? activeIconName : iconName) as keyof typeof MaterialCommunityIcons.glyphMap
            }
            size={22}
            color={isFocused ? onIndicatorColor : inactiveColor}
          />

          {/* Optional Badge */}
          {badge !== undefined && badge !== false && (
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.error },
                typeof badge === 'boolean' && styles.dotBadge,
              ]}
            >
              {typeof badge !== 'boolean' && (
                <Text
                  style={[styles.badgeText, { color: colors.onError }]}
                  numberOfLines={1}
                >
                  {badge}
                </Text>
              )}
            </View>
          )}
        </Animated.View>
      </View>

      {/* Label Text */}
      <Animated.Text
        style={[
          styles.label,
          {
            color: isFocused ? colors.onSurface : inactiveColor,
            fontWeight: isFocused ? '600' : '500',
          },
          labelStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
});

export const ExpressiveNavigationBar: React.FC<ExpressiveNavigationBarProps> = React.memo(
  function ExpressiveNavigationBar({
    state,
    descriptors,
    emitter,
    navigateToTab,
    destinations,
  }) {
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.surfaceContainer,
            borderTopColor: colors.outlineVariant,
            paddingBottom: Math.max(insets.bottom, 6),
          },
        ]}
      >
        <View style={styles.contentRow}>
          {state.routes.map((route, index) => {
            const descriptor = descriptors[route.key];
            const options = descriptor?.options ?? {};
            const isFocused = state.index === index;

            const override = destinations?.[route.name];
            const fallback = DEFAULT_ROUTE_ICONS[route.name] || {
              label: options.title || route.name,
              icon: 'circle-outline',
              activeIcon: 'circle',
            };

            const label =
              override?.label ??
              (options.tabBarLabel !== undefined
                ? String(options.tabBarLabel)
                : options.title !== undefined
                ? options.title
                : fallback.label);

            const iconName = override?.icon ?? fallback.icon;
            const activeIconName =
              override?.activeIcon ?? fallback.activeIcon;
            const badge = override?.badge ?? options.tabBarBadge;

            const onPress = () => {
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
                data: undefined,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigateToTab(route.key);
              }
            };

            const onLongPress = () => {
              emitter.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            return (
              <NavigationBarItem
                key={route.key}
                routeKey={route.key}
                routeName={route.name}
                label={label}
                iconName={iconName}
                activeIconName={activeIconName}
                badge={badge}
                isFocused={isFocused}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            );
          })}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    // M3 Expressive Spec: 64dp container height + safe area bottom padding
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  contentRow: {
    height: 64, // M3 Expressive short navigation bar height specification
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  itemContainer: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  pillWrapper: {
    width: 56, // M3 Expressive indicator pill width
    height: 32, // M3 Expressive indicator pill height
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  activeIndicatorPill: {
    ...StyleSheet.absoluteFill,
    borderRadius: 16,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    position: 'relative',
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.2,
    marginTop: 4,
    textAlign: 'center',
    includeFontPadding: false,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dotBadge: {
    minWidth: 6,
    height: 6,
    borderRadius: 3,
    top: -2,
    right: -4,
    paddingHorizontal: 0,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
