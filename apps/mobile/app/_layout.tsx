import { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter, useSegments, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { recordRoute } from '../services/diagnostics';
import axios from 'axios';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore, mapUser } from '../store/authStore';
import api from '../services/api';
import { CONFIG } from '../config';
import { startFeedbackQueue } from '../services/feedbackQueue';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1120', padding: 24 }}>
      <Text style={{ color: '#F8FAFC', fontSize: 18, fontWeight: '700' }}>Something went wrong</Text>
      <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
        An unexpected error occurred. Please try again.
      </Text>
      {__DEV__ && (
        <Text style={{ color: '#EF4444', fontSize: 11, marginTop: 12 }}>{error.message}</Text>
      )}
      <RetryButton label="Try again" onPress={retry} />
    </View>
  );
}

function RetryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ marginTop: 20, backgroundColor: '#F97316', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 }}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>{label}</Text>
    </TouchableOpacity>
  );
}

function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => NetInfo.addEventListener((s) => setOffline(s.isConnected === false || s.isInternetReachable === false)), []);
  if (!offline) return null;
  return (
    <View style={{ backgroundColor: '#B91C1C', paddingVertical: 6, paddingHorizontal: 12 }} pointerEvents="none">
      <Text style={{ color: '#fff', fontSize: 12, textAlign: 'center' }}>You're offline. Some features may not work.</Text>
    </View>
  );
}

export default function RootLayout() {
  const { user, institution, isLoaded, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const [serverReady, setServerReady] = useState(false);
  const [serverError, setServerError] = useState(false);

  const checkServer = useCallback(async () => {
    setServerError(false);
    try {
      await axios.get(`${CONFIG.API_URL.replace('/api', '')}/api/health`, { timeout: 15000 });
      setServerReady(true);
    } catch {
      setServerError(true);
    }
  }, []);

  // Retry any review that was saved offline, on reconnect and when the app returns to the foreground.
  useEffect(() => startFeedbackQueue(), []);

  // Last 20 route changes, kept in memory only, attached to bug reports when the user allows it.
  useEffect(() => { recordRoute(pathname); }, [pathname]);

  useEffect(() => {
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
        const { data } = await api.get('/auth/me');
        if (data.user) {
          const mapped = mapUser(data.user);
          await AsyncStorage.setItem('user', JSON.stringify(mapped));
          useAuthStore.setState({ user: mapped, isLoaded: true });
        }
      } catch {
        // Backend unreachable or user not registered — proceed normally, loadFromStorage will handle
      }
    });

    return unsubscribe;
  }, [checkServer]);

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
        <RetryButton label="Retry" onPress={checkServer} />
      </View>
    );
  }

  if (!serverReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0B1120' }}>
        <ActivityIndicator size="large" color="#F97316" />
        <Text style={{ color: '#94A3B8', marginTop: 16, fontSize: 14 }}>Starting Campus Khana...</Text>
        <Text style={{ color: '#475569', marginTop: 8, fontSize: 12 }}>This may take a few seconds</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="select-institution" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="canteen/[id]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="cart" options={{ headerShown: true, title: 'Cart' }} />
        <Stack.Screen name="checkout" options={{ headerShown: true, title: 'Checkout' }} />
        <Stack.Screen name="assistant" options={{ headerShown: true, title: 'Khana Assistant' }} />
        <Stack.Screen name="order/[id]" options={{ headerShown: true, title: 'Order Tracking' }} />
        <Stack.Screen name="feedback/order/[orderId]" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="feedback/app" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="feedback/mine" />
      </Stack>
    </View>
  );
}
