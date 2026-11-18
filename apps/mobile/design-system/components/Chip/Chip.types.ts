import React from 'react';
import {
  GestureResponderEvent,
  ImageSourcePropType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';

/**
 * Material 3 Chip Types from material-web / M3 Specification:
 * - assist: Smart/automated actions (e.g., "Add to calendar", "Directions")
 * - filter: Content filtering tags, toggling selected state (e.g., "Veg", "Fast Delivery")
 * - input: User-entered discrete entities with optional avatar and remove action (e.g., contacts, search tags)
 * - suggestion: Contextual suggestions (e.g., "Quick reply", "Recommended")
 */
export type ChipType = 'assist' | 'filter' | 'input' | 'suggestion';

export interface ExpressiveChipProps {
  /** The text label displayed inside the chip */
  label: string;
  /** Chip functional variant */
  type?: ChipType;
  /** Selected state (primarily for filter chips and selectable input chips) */
  selected?: boolean;
  /** Selection toggle callback */
  onSelectedChange?: (selected: boolean) => void;
  /** Primary press handler */
  onPress?: (e?: GestureResponderEvent) => void;
  /** Elevated surface styling (for high contrast over images or busy surfaces) */
  elevated?: boolean;
  /** Whether the chip can be removed (renders trailing close icon) */
  removable?: boolean;
  /** Callback when remove trailing action is clicked */
  onRemove?: () => void;
  /** For input chips: only the remove button triggers an action */
  removeOnly?: boolean;
  /** Optional leading icon (MaterialCommunityIcons name or React element) */
  icon?: string | React.ReactNode;
  /** Optional icon shown when chip is selected (defaults to checkmark for filter chips) */
  selectedIcon?: string | React.ReactNode;
  /** Avatar image source (for input chips, renders in a 24dp circular container) */
  avatar?: ImageSourcePropType | string;
  /** Disabled state */
  disabled?: boolean;
  /** Container style */
  style?: StyleProp<ViewStyle>;
  /** Label text style */
  labelStyle?: StyleProp<TextStyle>;
  /** Accessibility metadata */
  accessibilityLabel?: string;
  testID?: string;
}

export interface ChipSetProps {
  /** Array of chips or arbitrary children */
  children: React.ReactNode;
  /** Horizontal scrollable row vs flex-wrap row */
  scrollable?: boolean;
  /** Gap between chips (defaults to 8dp per M3 spec) */
  gap?: number;
  /** Container style */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
}
