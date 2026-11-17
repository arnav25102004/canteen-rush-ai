import React from 'react';
import { Card as PaperCard } from 'react-native-paper';
import { StyleProp, ViewStyle } from 'react-native';

export interface AppCardProps {
  children: React.ReactNode;
  mode?: 'elevated' | 'outlined' | 'contained';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, mode = 'contained', onPress, style }: AppCardProps) {
  return (
    <PaperCard
      mode={mode}
      onPress={onPress}
      style={[{ borderRadius: 20, overflow: 'hidden' }, style]}
    >
      {children}
    </PaperCard>
  );
}
