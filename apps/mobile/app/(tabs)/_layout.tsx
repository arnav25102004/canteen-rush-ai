import { Tabs } from 'expo-router';
import React from 'react';
import { useTheme } from '../../design-system/theme/ThemeProvider';
import { ExpressiveNavigationBar } from '../../design-system/components/NavigationBar';

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      tabBar={(props) => <ExpressiveNavigationBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: colors.surfaceContainer,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.outlineVariant,
        },
        headerTintColor: colors.onSurface,
        headerTitleStyle: {
          fontWeight: '600',
          fontSize: 18,
          letterSpacing: 0.15,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Canteens',
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
        }}
      />
    </Tabs>
  );
}
