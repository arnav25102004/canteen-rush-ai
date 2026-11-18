import React from 'react';
import { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from 'react-native';

/**
 * Three core Material 3 Expressive variants:
 * - filled: High-emphasis solid container
 * - tonal: Medium-emphasis container using secondaryContainer
 * - text: Low-emphasis transparent container
 */
export type ExpressiveButtonVariant = 'filled' | 'tonal' | 'text';

export interface ExpressiveButtonProps {
  /** Optional text label (omitted when used as an IconButton) */
  label?: string;
  /** Primary icon element or render function */
  icon?: React.ReactNode;
  /** Optional trailing icon */
  trailingIcon?: React.ReactNode;
  /** Tap / click callback */
  onPress?: (e?: GestureResponderEvent) => void;
  /** Variant style */
  variant?: ExpressiveButtonVariant;
  /** Size tier */
  size?: 'small' | 'medium' | 'large';
  /** Push button vs. Toggle / Selectable mode */
  isToggle?: boolean;
  /** Selected / Checked state when isToggle = true */
  isSelected?: boolean;
  /** Callback fired when toggle changes */
  onToggleChange?: (selected: boolean) => void;
  /** Enables dynamic 3-stage radius morphing (Resting -> Toggled -> Pressed) */
  radiusMorph?: boolean;
  /** Enables spatial physical length expansion along active axis on press (default false) */
  shapeMorph?: boolean;
  /** Loading indicator state */
  loading?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Full container width expansion */
  fullWidth?: boolean;
  /** Custom container style override */
  style?: StyleProp<ViewStyle>;
  /** Custom label typography style override */
  labelStyle?: StyleProp<TextStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
  /** Accessibility hint */
  accessibilityHint?: string;
  /** Test identifier */
  testID?: string;
}
