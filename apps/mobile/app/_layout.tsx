import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import axios from 'axios';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useAuthStore } from '../store/authStore';
import { CONFIG } from '../config';

export default function RootLayout() {
  const { user, institution, isLoaded, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();
  const [serverReady, setServerReady] = useState(false);
  const [serverError, setServerError] = useState(false);

  useEffect(() => {
    const checkServer = async () => {
      try {
        await axios.get(`${CONFIG.API_URL.replace('/api', '')}/api/health`, { timeout: 60000 });
        setServerReady(true);
      } catch {
        setServerError(true);
      }
    };
    checkServer();

    // Restore cached session from AsyncStorage first (instant)
    loadFromStorage();

    // Firebase onAuthStateChanged fires once on app start with the persisted user.
    // If Firebase has a session but AsyncStorage doesn't (e.g. fresh install on same account),
    // auto-fetch the profile from the backend so the user stays logged in.
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) return; // Not logged in — let loadFromStorage handle redirect
      const stored = useAuthStore.getState();
      if (stored.user) return; // Already restored from AsyncStorage — nothing to do

      try {
        const token = await firebaseUser.getIdToken();
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const { data } = await axios.get(`${CONFIG.API_URL}/auth/me`);
        if (data.user) {
          const { AsyncStorage } = await import('@react-native-async-storage/async-storage');
          await AsyncStorage.multiSet([
            ['user', JSON.stringify(data.user)],
            ['auth_token', token],
          ]);
          useAuthStore.setState({ user: data.user, token, isLoaded: true });
        }
      } catch {
        // Backend unreachable or user not registered — proceed normally, loadFromStorage will handle
      }
    });

    return unsubscribe;
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

  if (serverError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1120' }}>
        <Text style={{ color: '#EF4444', fontSize: 16 }}>Unable to connect to server</Text>
        <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 8 }}>Check your internet connection</Text>
      </View>
    );
  }

  if (!serverReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1120' }}>
        <ActivityIndicator size="large" color="#F97316" />
        <Text style={{ color: '#94A3B8', marginTop: 16, fontSize: 14 }}>Starting CanteenRush...</Text>
        <Text style={{ color: '#475569', marginTop: 8, fontSize: 12 }}>First load may take up to 60 seconds</Text>
      </View>
    );
  }

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
