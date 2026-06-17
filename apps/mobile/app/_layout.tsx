import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../store/authStore';

export default function RootLayout() {
  const { user, institution, isLoaded, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    loadFromStorage();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const inAuth = segments[0] === '(auth)';
    const inSelectInstitution = segments[0] === 'select-institution';

    if (!institution && !inSelectInstitution) {
      router.replace('/select-institution');
    } else if (institution && !user && !inAuth) {
      router.replace('/(auth)/login');
    } else if (institution && user && (inAuth || inSelectInstitution)) {
      router.replace('/(tabs)/home');
    }
  }, [user, institution, isLoaded, segments]);

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="select-institution" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="canteen/[id]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="cart" options={{ headerShown: true, title: 'Cart' }} />
        <Stack.Screen name="checkout" options={{ headerShown: true, title: 'Checkout' }} />
        <Stack.Screen name="order/[id]" options={{ headerShown: true, title: 'Order Tracking' }} />
        <Stack.Screen name="payment" options={{ headerShown: true, title: 'Payment' }} />
      </Stack>
    </View>
  );
}
