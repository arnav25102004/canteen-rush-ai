import { WithSpringConfig } from 'react-native-reanimated';

/**
 * Material 3 Expressive Physics-Based Motion System
 * 
 * Divided into:
 * 1. Spatial Springs (Position, Scale, Corner Radius) -> Natural overshoot & tactile bounce
 * 2. Effects Springs (Opacity, Color, Surface tone)    -> Strictly critically damped (zero overshoot)
 * 3. Standard Scheme                                  -> High damping for utilitarian controls
 */

export const MotionTokens = {
  // Spatial Springs: Designed for shape-morphs, scale bounce, and position shifts
  spatial: {
    /** Micro-interactions: Toggles, small icons, ripple bounds */
    fast: {
      damping: 18,
      stiffness: 300,
      mass: 0.8,
    } as WithSpringConfig,

    /** Default: Buttons, cards, bottom sheets, chip presses */
    default: {
      damping: 15,
      stiffness: 180,
      mass: 1.0,
    } as WithSpringConfig,

    /** Macro: Screen transitions, hero modal expansions */
    slow: {
      damping: 20,
      stiffness: 110,
      mass: 1.2,
    } as WithSpringConfig,
  },

  // Effects Springs: Strictly zero overshoot for color, opacity, and tone transitions
  effects: {
    fast: {
      damping: 26,
      stiffness: 320,
      mass: 0.8,
    } as WithSpringConfig,

    default: {
      damping: 24,
      stiffness: 200,
      mass: 1.0,
    } as WithSpringConfig,

    slow: {
      damping: 28,
      stiffness: 130,
      mass: 1.2,
    } as WithSpringConfig,
  },

  // Standard Scheme: Higher damping, minimal bounce for high-density tools
  standard: {
    default: {
      damping: 26,
      stiffness: 220,
      mass: 1.0,
    } as WithSpringConfig,
  },
};
