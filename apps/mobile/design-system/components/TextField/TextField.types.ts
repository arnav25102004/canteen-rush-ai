import React from 'react';
import {
  KeyboardTypeOptions,
  NativeSyntheticEvent,
  ReturnKeyTypeOptions,
  StyleProp,
  TextInputFocusEventData,
  TextStyle,
  ViewStyle,
} from 'react-native';

export type TextFieldVariant = 'filled' | 'outlined';

export interface AppTextFieldProps {
  /** Label floating text or placeholder */
  label: string;
  /** Current string value */
  value: string;
  /** Change callback */
  onChangeText: (text: string) => void;
  /** Visual variant: 'outlined' (standard M3 container) or 'filled' */
  variant?: TextFieldVariant;
  /** Static placeholder text (when unfocused or empty) */
  placeholder?: string;
  /** Supporting text displayed beneath the field */
  helperText?: string;
  /** Error message (triggers error state and color shift) */
  error?: string | boolean;
  /** Obscures input text for passwords */
  secureTextEntry?: boolean;
  /** Keyboard layout */
  keyboardType?: KeyboardTypeOptions;
  /** Auto capitalization rule */
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** Return key behavior on virtual keyboard */
  returnKeyType?: ReturnKeyTypeOptions;
  /** Auto focus on mount */
  autoFocus?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Leading icon name or React node */
  leftIcon?: string | React.ReactNode;
  /** Trailing icon name or React node (e.g., eye toggle, clear button) */
  rightIcon?: string | React.ReactNode;
  /** Callback when right icon is clicked */
  onRightIconPress?: () => void;
  /** Blur callback */
  onBlur?: (e: NativeSyntheticEvent<TextInputFocusEventData>) => void;
  /** Focus callback */
  onFocus?: (e: NativeSyntheticEvent<TextInputFocusEventData>) => void;
  /** Outer container style override */
  style?: StyleProp<ViewStyle>;
  /** Input text style override */
  inputStyle?: StyleProp<TextStyle>;
  /** Test identifier */
  testID?: string;
}
