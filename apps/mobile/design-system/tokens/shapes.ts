/**
 * Material 3 Expressive Shape Tokens & Primitives
 * Combines standard geometric radii with dynamic morph states.
 */

export const ShapeTokens = {
  // Classic Radii
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 9999, // Pill silhouette

  // Interactive Morph States
  button: {
    // Standard unpressed state
    defaultRadius: 9999,
    // Morphs into a rounded squircle upon press/selection
    pressedRadius: 16,
    // Minimum interactive touch dimension
    touchTargetMin: 48,
  },

  card: {
    hero: 28,
    standard: 20,
    compact: 14,
    // Morph radius on card touch
    pressedHero: 22,
    pressedStandard: 16,
  },

  chip: {
    unselected: 12,
    selected: 9999, // Morphs into pill when activated
    pressed: 8,
  },
};
