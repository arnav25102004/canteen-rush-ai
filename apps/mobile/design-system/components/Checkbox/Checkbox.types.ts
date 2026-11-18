import { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from 'react-native';

export interface ExpressiveCheckboxProps {
  /** Checked boolean state */
  checked: boolean;
  /** Callback on change */
  onCheckedChange: (checked: boolean) => void;
  /** Optional label text adjacent to the checkbox */
  label?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Optional error state styling */
  error?: boolean;
  /** Container style */
  style?: StyleProp<ViewStyle>;
  /** Label text style */
  labelStyle?: StyleProp<TextStyle>;
  /** Accessibility metadata */
  accessibilityLabel?: string;
  testID?: string;
}
