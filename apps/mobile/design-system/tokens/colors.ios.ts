/**
 * Apple Human Interface Guidelines Dynamic Colors (iOS)
 * Synchronized with the M3 Campus Expressive Brand
 */

export const CupertinoLightColors = {
  primary: '#FF6422',
  onPrimary: '#FFFFFF',

  systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7',
  tertiarySystemBackground: '#FFFFFF',

  systemGroupedBackground: '#F2F2F7',
  secondaryGroupedBackground: '#FFFFFF',
  tertiaryGroupedBackground: '#F2F2F7',

  label: '#000000',
  secondaryLabel: '#3C3C4399',
  tertiaryLabel: '#3C3C434D',
  quaternaryLabel: '#3C3C432E',

  separator: '#3C3C434A',
  opaqueSeparator: '#C6C6C8',

  systemRed: '#FF3B30',
  systemGreen: '#34C759',
  systemBlue: '#007AFF',
  systemOrange: '#FF9500',
  systemYellow: '#FFCC00',
  systemGray: '#8E8E93',
  systemGray5: '#E5E5EA',
  systemGray6: '#F2F2F7',
};

export const CupertinoDarkColors = {
  primary: '#FF8A50',
  onPrimary: '#201A17',

  systemBackground: '#000000',
  secondarySystemBackground: '#1C1C1E',
  tertiarySystemBackground: '#2C2C2E',

  systemGroupedBackground: '#000000',
  secondaryGroupedBackground: '#1C1C1E',
  tertiaryGroupedBackground: '#2C2C2E',

  label: '#FFFFFF',
  secondaryLabel: '#EBEBF599',
  tertiaryLabel: '#EBEBF54D',
  quaternaryLabel: '#EBEBF52E',

  separator: '#54545899',
  opaqueSeparator: '#38383A',

  systemRed: '#FF453A',
  systemGreen: '#32D74B',
  systemBlue: '#0A84FF',
  systemOrange: '#FF9F0A',
  systemYellow: '#FFD60A',
  systemGray: '#8E8E93',
  systemGray5: '#2C2C2E',
  systemGray6: '#1C1C1E',
};

export type CupertinoColorScheme = typeof CupertinoLightColors;
