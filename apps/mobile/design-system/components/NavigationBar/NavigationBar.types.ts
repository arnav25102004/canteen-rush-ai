import type { BottomTabBarProps } from 'expo-router/tabs';

export interface NavigationBarDestination {
  label: string;
  icon: string; // MaterialCommunityIcons name
  activeIcon?: string; // MaterialCommunityIcons name when active
  badge?: string | number | boolean;
}

export interface ExpressiveNavigationBarProps extends BottomTabBarProps {
  destinations?: Record<string, NavigationBarDestination>;
}
