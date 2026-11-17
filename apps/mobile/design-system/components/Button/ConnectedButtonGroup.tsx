import React from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MotionTokens } from '../../tokens/motion';
import { TypographyTokens } from '../../tokens/typography';
import { useAppTheme } from '../../theme/ThemeProvider';

export interface ButtonGroupItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface ConnectedButtonGroupProps {
  items: ButtonGroupItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  fullWidth?: boolean;
}

export const ConnectedButtonGroup = React.memo(function ConnectedButtonGroup({
  items,
  selectedId,
  onSelect,
  fullWidth = true,
}: ConnectedButtonGroupProps) {
  const { colors, isDark } = useAppTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? colors.surfaceContainerHigh
            : colors.surfaceContainer,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
      ]}
      accessibilityRole="tablist"
    >
      {items.map((item, index) => {
        const isSelected = item.id === selectedId;
        const isFirst = index === 0;
        const isLast = index === items.length - 1;

        return (
          <GroupSegment
            key={item.id}
            item={item}
            isSelected={isSelected}
            isFirst={isFirst}
            isLast={isLast}
            onSelect={() => onSelect(item.id)}
            colors={colors}
            isDark={isDark}
          />
        );
      })}
    </View>
  );
});

function GroupSegment({
  item,
  isSelected,
  isFirst,
  isLast,
  onSelect,
  colors,
  isDark,
}: {
  item: ButtonGroupItem;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  colors: any;
  isDark: boolean;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scale.value = withSpring(0.95, MotionTokens.spatial.fast);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1.0, MotionTokens.spatial.default);
  };

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>
      <Pressable
        onPress={onSelect}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="tab"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={item.label}
        style={[
          styles.segment,
          {
            backgroundColor: isSelected
              ? colors.primary
              : 'transparent',
            borderRadius: isSelected ? 20 : 12,
            marginLeft: isFirst ? 0 : 2,
            marginRight: isLast ? 0 : 2,
          },
        ]}
      >
        <View style={styles.contentRow}>
          {item.icon ? <View style={{ marginRight: 6 }}>{item.icon}</View> : null}
          <Text
            style={[
              styles.segmentText,
              {
                color: isSelected ? colors.onPrimary : colors.onSurface,
                fontWeight: isSelected ? '700' : '500',
              },
            ]}
          >
            {item.label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 24,
  },
  segment: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: TypographyTokens.labelLarge.fontSize,
    letterSpacing: 0.2,
  },
});
