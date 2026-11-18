import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

/**
 * Complete Material 3 Expressive Shape Catalog (MaterialShape)
 * Official 23-shape taxonomy introduced in Android 15 / M3 Expressive
 */
export enum MaterialShape {
  Circle = 'Circle',
  Square = 'Square',
  Oval = 'Oval',
  Pill = 'Pill',
  SemiCircle = 'SemiCircle',
  Triangle = 'Triangle',
  Pentagon = 'Pentagon',
  Diamond = 'Diamond',
  Slanted = 'Slanted',
  Arch = 'Arch',
  Arrow = 'Arrow',
  Fan = 'Fan',
  Gem = 'Gem',
  ClamShell = 'ClamShell',
  Ghostish = 'Ghostish',
  Sunny = 'Sunny',
  VerySunny = 'VerySunny',
  SoftBurst = 'SoftBurst',
  Cookie4Sided = 'Cookie4Sided',
  Cookie6Sided = 'Cookie6Sided',
  Cookie7Sided = 'Cookie7Sided',
  Cookie9Sided = 'Cookie9Sided',
  Cookie12Sided = 'Cookie12Sided',
}

export interface ExpressiveLoadingIndicatorProps {
  /** Size in pixels (default: 38px) */
  size?: number;
  /** Fill color (defaults to M3 primary token) */
  color?: string;
  /** When housing an interior icon, omits Pentagon for clearance */
  containsIcon?: boolean;
  /** Optional centered icon to render inside the morphing shape */
  icon?: React.ReactNode;
  /** Custom shape sequence to cycle through */
  sequence?: MaterialShape[];
  /** Optional container style */
  style?: StyleProp<ViewStyle>;
  /** Accessibility metadata */
  accessibilityLabel?: string;
  testID?: string;
}
