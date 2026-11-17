import { StyleProp, ViewStyle } from 'react-native';

export interface ExpressiveSwitchProps {
  /** Checked / active state of the switch */
  value: boolean;
  /** Callback invoked on state toggle */
  onValueChange?: (value: boolean) => void;
  /** Whether the switch is interactive */
  disabled?: boolean;
  /** Base track height (defaults to standard M3 Expressive 32dp) */
  size?: number;
  /** Accessibility label for assistive technologies */
  accessibilityLabel?: string;
  /** Accessibility hint */
  accessibilityHint?: string;
  /** Container style override */
  style?: StyleProp<ViewStyle>;
  /** Test identifier */
  testID?: string;
}
