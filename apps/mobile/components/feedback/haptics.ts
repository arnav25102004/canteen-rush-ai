import * as Haptics from 'expo-haptics';

// Haptics are decoration: never let a missing motor break the flow.
export function tick() { Haptics.selectionAsync().catch(() => {}); }
export function success() { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
