import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';
import { useAuthStore } from '../store/authStore';

interface Slot { id: string; startTime: string; endTime: string; available: number; }

type PaymentMethod = 'WALLET' | 'RAZORPAY';

export default function CheckoutScreen() {
  const router = useRouter();
  const { canteenId, canteenName, items, total, clear } = useCartStore();
  const { user } = useAuthStore();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WALLET');

  useEffect(() => {
    Promise.all([
      api.get('/wallet').then(r => setWallet(r.data.wallet)),
      canteenId
        ? api.get(`/canteens/${canteenId}/slots`).then(r => {
            const available = (r.data.slots || []).filter((s: any) => s.available > 0);
            setSlots(available);
            if (available.length > 0) setSelectedSlot(available[0].id);
          })
        : Promise.resolve(),
    ]).finally(() => setLoading(false));
  }, [canteenId]);

  async function placeWithWallet() {
    if (!canteenId) return;
    const balance = Number(wallet?.balance || 0);
    const orderTotal = total();

    if (balance < orderTotal) {
      Alert.alert('Insufficient Balance', `You need ₹${(orderTotal - balance).toFixed(0)} more.`, [
        { text: 'Cancel' },
        { text: 'Recharge', onPress: () => router.push('/(tabs)/wallet') },
      ]);
      return;
    }

    setPlacing(true);
    try {
      const { data } = await api.post('/orders', {
        canteenId,
        slotId: selectedSlot || undefined,
        paymentMethod: 'WALLET',
        items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
      });
      clear();
      router.replace(`/order/${data.order.id}`);
    } catch (err: any) {
      Alert.alert('Order Failed', err.response?.data?.error || 'Something went wrong');
    } finally {
      setPlacing(false);
    }
  }

  async function placeWithRazorpay() {
    if (!canteenId) return;
    setPlacing(true);
    try {
      const { data } = await api.post('/payment/create-order', {
        amount: total(),
        receipt: `order_${Date.now()}`,
      });
      const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
      router.push({
        pathname: '/payment',
        params: {
          razorpayOrderId: data.orderId,
          amount: String(data.amount),
          keyId: data.keyId,
          userName: user?.name || '',
          userEmail: user?.email || '',
          cartJson: JSON.stringify(items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity }))),
          canteenId: canteenId,
          slotId: selectedSlot || '',
          baseUrl,
        },
      });
    } catch (err: any) {
      Alert.alert('Payment Error', err.response?.data?.detail || 'Could not initiate payment');
    } finally {
      setPlacing(false);
    }
  }

  function handlePlaceOrder() {
    if (paymentMethod === 'RAZORPAY') placeWithRazorpay();
    else placeWithWallet();
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;

  const orderTotal = total();
  const balance = Number(wallet?.balance || 0);
  const hasEnoughWallet = balance >= orderTotal;
  const canProceed = paymentMethod === 'RAZORPAY' || hasEnoughWallet;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8f9fa' }} contentContainerStyle={{ padding: 16 }}>
      <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 12 }}>
        <Text style={{ fontSize: 24, color: '#1a1a2e' }}>←</Text>
      </TouchableOpacity>

      <Text style={styles.pageTitle}>Checkout</Text>
      <Text style={styles.canteenLabel}>{canteenName}</Text>

      {/* Order Summary */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Order Summary</Text>
        {items.map(item => (
          <View key={item.menuItemId} style={styles.row}>
            <Text style={styles.rowLabel}>{item.name} ×{item.quantity}</Text>
            <Text style={styles.rowValue}>₹{(item.price * item.quantity).toFixed(0)}</Text>
          </View>
        ))}
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>₹{orderTotal.toFixed(0)}</Text>
        </View>
      </View>

      {/* Pickup Slot */}
      {slots.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Pickup Slot</Text>
          {slots.map(slot => (
            <TouchableOpacity key={slot.id} style={[styles.slotChip, selectedSlot === slot.id && styles.slotChipActive]}
              onPress={() => setSelectedSlot(slot.id)}>
              <Text style={[styles.slotText, selectedSlot === slot.id && styles.slotTextActive]}>
                {slot.startTime}–{slot.endTime}
              </Text>
              <Text style={[styles.slotAvail, selectedSlot === slot.id && { color: '#ffffff80' }]}>
                {slot.available} left
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Payment Method */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Payment Method</Text>

        {/* Wallet option */}
        <TouchableOpacity style={[styles.payOption, paymentMethod === 'WALLET' && styles.payOptionActive]}
          onPress={() => setPaymentMethod('WALLET')}>
          <View style={[styles.radio, paymentMethod === 'WALLET' && styles.radioActive]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.payOptionTitle}>Wallet</Text>
            <Text style={[styles.walletBalance, !hasEnoughWallet && paymentMethod === 'WALLET' && { color: '#ef4444' }]}>
              Balance: ₹{balance.toFixed(2)}
            </Text>
            {paymentMethod === 'WALLET' && !hasEnoughWallet && (
              <Text style={styles.insufficientText}>
                Need ₹{(orderTotal - balance).toFixed(0)} more —{' '}
                <Text style={{ color: '#e94560', fontWeight: '600' }} onPress={() => router.push('/(tabs)/wallet')}>
                  Recharge
                </Text>
              </Text>
            )}
          </View>
        </TouchableOpacity>

        {/* Razorpay option */}
        <TouchableOpacity style={[styles.payOption, paymentMethod === 'RAZORPAY' && styles.payOptionActive]}
          onPress={() => setPaymentMethod('RAZORPAY')}>
          <View style={[styles.radio, paymentMethod === 'RAZORPAY' && styles.radioActive]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.payOptionTitle}>Pay Online</Text>
            <Text style={styles.payOptionSub}>UPI · Cards · Net Banking via Razorpay</Text>
          </View>
          <Text style={styles.razorpayBadge}>razorpay</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.placeBtn, (!canProceed || placing) && styles.placeBtnDisabled]}
        onPress={handlePlaceOrder}
        disabled={!canProceed || placing}>
        {placing
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.placeBtnText}>
              {paymentMethod === 'RAZORPAY' ? `Pay ₹${orderTotal.toFixed(0)} Online` : `Place Order ₹${orderTotal.toFixed(0)}`}
            </Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pageTitle: { fontSize: 24, fontWeight: '800', color: '#1a1a2e', marginBottom: 2 },
  canteenLabel: { fontSize: 14, color: '#888', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  rowLabel: { fontSize: 14, color: '#555', flex: 1 },
  rowValue: { fontSize: 14, color: '#333', fontWeight: '500' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 10, marginTop: 4 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  totalAmount: { fontSize: 18, fontWeight: 'bold', color: '#1a1a2e' },
  slotChip: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 8 },
  slotChipActive: { borderColor: '#1a1a2e', backgroundColor: '#1a1a2e' },
  slotText: { fontSize: 14, fontWeight: '600', color: '#333' },
  slotTextActive: { color: '#fff' },
  slotAvail: { fontSize: 12, color: '#888' },
  payOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 8 },
  payOptionActive: { borderColor: '#e94560', backgroundColor: '#fff5f7' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ccc' },
  radioActive: { borderColor: '#e94560', backgroundColor: '#e94560' },
  payOptionTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  payOptionSub: { fontSize: 11, color: '#888', marginTop: 2 },
  walletBalance: { fontSize: 13, color: '#10b981', fontWeight: '600' },
  insufficientText: { fontSize: 12, color: '#ef4444', marginTop: 4 },
  razorpayBadge: { fontSize: 10, color: '#3395FF', fontWeight: '700', letterSpacing: 0.5 },
  placeBtn: { backgroundColor: '#e94560', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 32 },
  placeBtnDisabled: { opacity: 0.5 },
  placeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
