import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { MD3LightTheme, MD3DarkTheme, PaperProvider } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { M3LightColors, M3DarkColors, M3ColorScheme } from '../tokens/colors.android';
import { CupertinoLightColors, CupertinoDarkColors, CupertinoColorScheme } from '../tokens/colors.ios';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  isIOS: boolean;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  colors: M3ColorScheme;
  cupertinoColors: CupertinoColorScheme;
}

const ThemeContext = createContext<ThemeContextValue>({
  isIOS: Platform.OS === 'ios',
  isDark: false,
  mode: 'system',
  setMode: () => {},
  colors: M3LightColors,
  cupertinoColors: CupertinoLightColors,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');

  const isDark = useMemo(() => {
    if (mode === 'light') return false;
    if (mode === 'dark') return true;
    return systemScheme === 'dark';
  }, [mode, systemScheme]);

  const isIOS = Platform.OS === 'ios';

  const m3Colors = useMemo(() => (isDark ? M3DarkColors : M3LightColors), [isDark]);
  const cupertinoColors = useMemo(() => (isDark ? CupertinoDarkColors : CupertinoLightColors), [isDark]);

  // Configure Android system Navigation Bar
  useEffect(() => {
    if (Platform.OS === 'android') {
      try {
        NavigationBar.setStyle(isDark ? 'light' : 'dark');
      } catch (err) {}
    }
  }, [isDark]);

  const paperTheme = useMemo(() => {
    const base = isDark ? MD3DarkTheme : MD3LightTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        ...m3Colors,
      },
      roundness: 5, // M3 Expressive curve (20-26dp base)
    };
  }, [isDark, m3Colors]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      isIOS,
      isDark,
      mode,
      setMode,
      colors: m3Colors,
      cupertinoColors,
    }),
    [isIOS, isDark, mode, m3Colors, cupertinoColors]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <PaperProvider
        theme={paperTheme}
        settings={{
          icon: props => <MaterialCommunityIcons {...props} />,
        }}
      >
        {children}
      </PaperProvider>
    </ThemeContext.Provider>
  );
}

export const useAppTheme = () => useContext(ThemeContext);
export const useTheme = useAppTheme;

