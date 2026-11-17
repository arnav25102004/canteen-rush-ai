import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SharedValue } from 'react-native-reanimated';

export interface ExpressiveRippleProps {
  /** Width of the host container */
  width: number;
  /** Height of the host container */
  height: number;
  /** Reactive corner radius shared value or fixed number */
  borderRadius: SharedValue<number> | number;
  /** Tint color of the state layer (e.g., onPrimary, onSecondaryContainer) */
  color?: string;
  /** Maximum opacity reached by the state layer (defaults to 0.16) */
  maxOpacity?: number;
  /** Container style */
  style?: StyleProp<ViewStyle>;
}

export interface ExpressiveRippleHandle {
  /** Triggered on touch contact with exact local coordinates */
  onPressIn: (x: number, y: number) => void;
  /** Triggered on touch release */
  onPressOut: () => void;
  /** Optional hover state toggle */
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}
