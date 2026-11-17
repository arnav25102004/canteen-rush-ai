import React from 'react';
import { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from 'react-native';

export type IconButtonVariant = 'filled' | 'tonal' | 'standard';

export interface ExpressiveIconButtonProps {
  /** Name of the MaterialCommunityIcon */
  icon: string;
  /** Custom size of the icon (default 24px) */
  iconSize?: number;
  /** Callback triggered on press */
  onPress?: (e?: GestureResponderEvent) => void;
  /** Three core M3 variants */
  variant?: IconButtonVariant;
  /** Whether the button acts as a toggle switch */
  isToggle?: boolean;
  /** Toggle checked state */
  isSelected?: boolean;
  /** Toggle change listener */
  onToggleChange?: (selected: boolean) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Loading spinner state */
  loading?: boolean;
  /** Overall container dimension (default 48px to guarantee touch target) */
  size?: number;
  /** Style override */
  style?: StyleProp<ViewStyle>;
  /** Accessibility metadata */
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}
