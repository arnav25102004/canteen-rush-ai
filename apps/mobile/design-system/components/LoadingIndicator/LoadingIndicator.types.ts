import { StyleProp, ViewStyle } from 'react-native';

export interface ExpressiveLoadingIndicatorProps {
  /** Size in pixels (default: 38px) */
  size?: number;
  /** Fill color (defaults to M3 primary token) */
  color?: string;
  /** When housing an interior icon, omits Pentagon for clearance */
  containsIcon?: boolean;
  /** Optional centered icon to render inside the morphing shape */
  icon?: React.ReactNode;
  /** Optional container style */
  style?: StyleProp<ViewStyle>;
  /** Accessibility metadata */
  accessibilityLabel?: string;
  testID?: string;
}
