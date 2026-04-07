import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';

interface Slot { id: string; startTime: string; endTime: string; available: number; }

export default function CheckoutScreen() {
  const router = useRouter();
  const { canteenId, canteenName, items, total, clear } = useCartStore();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);

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

  async function placeOrder() {
    if (!canteenId) return;
    const balance = Number(wallet?.balance || 0);
    const orderTotal = total();

    if (balance < orderTotal) {
      Alert.alert('Insufficient Balance', `You need ₹${(orderTotal - balance).toFixed(0)} more. Please recharge your wallet.`, [
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

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;

  const orderTotal = total();
  const balance = Number(wallet?.balance || 0);
  const hasEnough = balance >= orderTotal;

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

      {/* Wallet Payment */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.walletRow}>
          <Text style={styles.walletLabel}>Wallet Balance</Text>
          <Text style={[styles.walletBalance, !hasEnough && { color: '#ef4444' }]}>₹{balance.toFixed(2)}</Text>
        </View>
        {!hasEnough && (
          <Text style={styles.insufficientText}>
            Need ₹{(orderTotal - balance).toFixed(0)} more —{' '}
            <Text style={{ color: '#e94560', fontWeight: '600' }} onPress={() => router.push('/(tabs)/wallet')}>
              Recharge
            </Text>
          </Text>
        )}
      </View>

      <TouchableOpacity style={[styles.placeBtn, (!hasEnough || placing) && styles.placeBtnDisabled]}
        onPress={placeOrder} disabled={!hasEnough || placing}>
        {placing ? <ActivityIndicator color="#fff" /> : <Text style={styles.placeBtnText}>Place Order ₹{orderTotal.toFixed(0)}</Text>}
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
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletLabel: { fontSize: 14, color: '#555' },
  walletBalance: { fontSize: 20, fontWeight: 'bold', color: '#10b981' },
  insufficientText: { fontSize: 13, color: '#ef4444', marginTop: 8 },
  placeBtn: { backgroundColor: '#e94560', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 32 },
  placeBtnDisabled: { opacity: 0.5 },
  placeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
