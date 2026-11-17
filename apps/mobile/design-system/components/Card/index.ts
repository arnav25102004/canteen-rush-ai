import { Platform } from 'react-native';
import { Card as AndroidCard, AppCardProps as AndroidCardProps } from './Card.android';
import { Card as IOSCard, AppCardProps as IOSCardProps } from './Card.ios';

export type AppCardProps = AndroidCardProps & IOSCardProps;

export const Card: React.FC<AppCardProps> = Platform.OS === 'ios' ? (IOSCard as any) : AndroidCard;
