import { Stack } from 'expo-router';

export { ErrorBoundary } from '../_layout';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
      }}
    />
  );
}
