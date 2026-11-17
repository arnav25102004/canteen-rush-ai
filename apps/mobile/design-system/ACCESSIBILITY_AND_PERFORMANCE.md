# Design System Performance & Accessibility (a11y) Standards

These engineering standards are strictly enforced across all design system components (`apps/mobile/design-system/components/`).

---

## 1. 60–120 FPS Fluidity & Smoothness

### Native Driver & Worklets
- All micro-interactions, scale transitions, and animations MUST execute on the UI thread using `useNativeDriver: true` or `react-native-reanimated` worklets.
- Avoid animating layout-triggering properties (`width`, `height`, `margin`, `top`, `padding`). Animate transform (`scale`, `translateX`, `translateY`) and `opacity` only.

### Render Hygiene
- Wrap interaction callbacks with `useCallback` and static styles with `StyleSheet.create`.
- Avoid creating inline objects/arrays inside `renderItem` or high-frequency loops.
- Prevent unnecessary re-renders using `React.memo` with custom comparison operators where complex SVG or icon rendering is involved.

### Touch & State Layer Latency
- Native state layers (Android Ripple via Android `selectableBackgroundBorderless` or Paper MD3 ink canvas; iOS light haptic impact `Haptics.ImpactFeedbackStyle.Light`) MUST fire immediately on touch down without waiting for JS event queue resolutions.

---

## 2. Inclusive Accessibility (WCAG 2.2 Level AA Standards)

### Minimum Touch Target Sizes
- All interactive controls (buttons, icon triggers, chips, list rows) MUST conform to at least **48 × 48 dp** physical touch boundary (`hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` when visual footprint is smaller).

### Semantic Roles & States
Every interactive component MUST explicitly pass:
- `accessible={true}`
- `accessibilityRole`: `'button' | 'header' | 'link' | 'search' | 'image' | 'alert' | 'checkbox' | 'radio' | 'tab'`
- `accessibilityLabel`: Clear, non-redundant descriptive label (never say "button" inside label).
- `accessibilityHint`: Action consequence description when context isn't obvious (e.g., *"Navigates to checkout screen"*).
- `accessibilityState`: Dynamic exposure of `{ disabled, busy, selected, checked, expanded }`.

### Color Contrast Ratios
- Text on primary/accent background: Minimum **4.5:1** contrast ratio for normal text and **3:1** for large titles (18pt+ / 14pt+ bold).
- Primary orange (`#E06D14`) paired with pure white (`#FFFFFF`) satisfies WCAG AA for prominent titles and buttons.

### Font Scaling & Dynamic Type
- Labels and texts must support dynamic font scaling (`allowFontScaling={true}`) without clipping containers or overflowing parent layouts.
