import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import api from '../../services/api';

const PAYMENT_TIMEOUT_SECONDS = 10 * 60; // 10 minutes

export default function PaymentPendingScreen() {
  const router = useRouter();
  const { orderId, amount, orderNumber, upiDeepLink } = useLocalSearchParams<{
    orderId: string;
    amount: string;
    orderNumber: string;
    upiDeepLink: string;
  }>();

  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(PAYMENT_TIMEOUT_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          Alert.alert('Order Expired', 'Your order was cancelled because payment was not completed in time.', [
            { text: 'OK', onPress: () => router.replace('/') },
          ]);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeDisplay = `${minutes}:${String(seconds).padStart(2, '0')}`;

  async function openUpiApp() {
    if (!upiDeepLink) return;
    const canOpen = await Linking.canOpenURL(upiDeepLink);
    if (canOpen) {
      await Linking.openURL(upiDeepLink);
    } else {
      Alert.alert('No UPI App Found', `Please pay ₹${amount} to the vendor manually.\n\nUse note: ${orderNumber}`);
    }
  }

  async function handleClaimPayment() {
    if (!orderId) return;
    setClaiming(true);
    try {
      await api.post(`/orders/${orderId}/claim-payment`);
      if (timerRef.current) clearInterval(timerRef.current);
      setClaimed(true);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not submit payment claim. Try again.');
    } finally {
      setClaiming(false);
    }
  }

  async function handleCancelOrder() {
    Alert.alert('Cancel Order?', 'Are you sure you want to cancel this order?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/orders/${orderId}/cancel`, { reason: 'Cancelled by student before payment' });
            router.replace('/');
          } catch {
            Alert.alert('Error', 'Could not cancel. Try again.');
          }
        },
      },
    ]);
  }

  if (claimed) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.icon}>⏳</Text>
          <Text style={styles.heading}>Verifying Payment</Text>
          <Text style={styles.sub}>
            The vendor is checking their GPay for payment of ₹{amount}.{'\n\n'}
            You'll be notified when they confirm. This usually takes 1–2 minutes.
          </Text>
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>Order #{orderNumber}</Text>
          </View>
          <TouchableOpacity style={styles.trackBtn} onPress={() => router.replace(`/order/${orderId}`)}>
            <Text style={styles.trackBtnText}>Track Order</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>💸</Text>
        <Text style={styles.heading}>Complete Your Payment</Text>
        <Text style={styles.sub}>
          Pay ₹{amount} to the vendor via UPI
        </Text>

        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>Pay to UPI ID</Text>
          <Text style={styles.noteText} selectable>{upiDeepLink?.match(/pa=([^&]+)/)?.[1] ?? ''}</Text>
          <Text style={[styles.noteLabel, { marginTop: 10 }]}>Amount</Text>
          <Text style={styles.noteText}>₹{amount}</Text>
          <Text style={[styles.noteLabel, { marginTop: 10 }]}>UPI Note / Reference</Text>
          <Text style={styles.noteText}>{orderNumber}</Text>
        </View>

        <TouchableOpacity style={styles.openUpiBtn} onPress={openUpiApp}>
          <Text style={styles.openUpiBtnText}>Open UPI App (PhonePe / GPay)</Text>
        </TouchableOpacity>

        <Text style={styles.alreadyPaidLabel}>Already paid?</Text>

        <TouchableOpacity
          style={[styles.claimBtn, claiming && styles.claimBtnDisabled]}
          onPress={handleClaimPayment}
          disabled={claiming}>
          {claiming
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.claimBtnText}>I've Paid — Confirm</Text>}
        </TouchableOpacity>

        <View style={styles.timerRow}>
          <Text style={styles.timerLabel}>Order expires in</Text>
          <Text style={[styles.timerValue, secondsLeft < 120 && { color: '#ef4444' }]}>{timeDisplay}</Text>
        </View>

        <TouchableOpacity style={styles.cancelLink} onPress={handleCancelOrder}>
          <Text style={styles.cancelLinkText}>✕ Cancel Order</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 28, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8 },
  icon: { fontSize: 56, marginBottom: 12 },
  heading: { fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  noteBox: { backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, width: '100%', alignItems: 'center', marginBottom: 20 },
  noteLabel: { fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  noteText: { fontSize: 18, fontWeight: '800', color: '#1a1a2e', letterSpacing: 1 },
  openUpiBtn: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, width: '100%', alignItems: 'center', marginBottom: 20 },
  openUpiBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  alreadyPaidLabel: { fontSize: 13, color: '#888', marginBottom: 10 },
  claimBtn: { backgroundColor: '#10b981', borderRadius: 12, padding: 16, width: '100%', alignItems: 'center', marginBottom: 20 },
  claimBtnDisabled: { opacity: 0.6 },
  claimBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  timerLabel: { fontSize: 13, color: '#888' },
  timerValue: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  cancelLink: { padding: 8 },
  cancelLinkText: { color: '#ef4444', fontSize: 14 },
  trackBtn: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, width: '100%', alignItems: 'center', marginTop: 12 },
  trackBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
