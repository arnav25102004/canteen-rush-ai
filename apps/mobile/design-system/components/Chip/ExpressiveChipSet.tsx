import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ChipSetProps } from './Chip.types';

/**
 * Material 3 Chip Set Toolbar Container (<md-chip-set>)
 * Formats a collection of chips in either a horizontally scrollable strip or a wrapping row.
 */
export const ExpressiveChipSet: React.FC<ChipSetProps> = React.memo(
  function ExpressiveChipSet({
    children,
    scrollable = true,
    gap = 8,
    style,
    accessibilityLabel = 'Chip group',
  }) {
    if (scrollable) {
      return (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { gap },
          ]}
          style={[styles.scrollContainer, style]}
          accessible
          accessibilityRole="toolbar"
          accessibilityLabel={accessibilityLabel}
        >
          {children}
        </ScrollView>
      );
    }

    return (
      <View
        style={[
          styles.wrapContainer,
          { gap },
          style,
        ]}
        accessible
        accessibilityRole="toolbar"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 0,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  wrapContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
