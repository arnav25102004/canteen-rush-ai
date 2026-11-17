import React from 'react';
import { ExpressiveButton } from './ExpressiveButton';
import { ExpressiveIconButton } from './ExpressiveIconButton';
import { ExpressiveButtonProps } from './ExpressiveButton.types';
import { ExpressiveIconButtonProps } from './IconButton.types';

export * from './Button.types';
export * from './ExpressiveButton.types';
export * from './ExpressiveButton';
export * from './IconButton.types';
export * from './ExpressiveIconButton';
export * from './ConnectedButtonGroup';

/**
 * Universal Button and IconButton exports
 */
export const Button: React.FC<ExpressiveButtonProps> = ExpressiveButton;
export const IconButton: React.FC<ExpressiveIconButtonProps> = ExpressiveIconButton;
