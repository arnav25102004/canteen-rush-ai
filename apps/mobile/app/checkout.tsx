import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';

export default function CheckoutScreen() {
  const router = useRouter();
  const { canteenId, canteenName, items, total, clear } = useCartStore();
  const [wallet, setWallet] = useState<{ balance: number } | null>(null);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    api.get('/wallet').then(r => setWallet(r.data.wallet)).finally(() => setLoading(false));
  }, []);

  async function handlePlaceOrder() {
    if (!canteenId) return;
    const orderTotal = total();
    const balance = Number(wallet?.balance || 0);

    if (balance < orderTotal) {
      Alert.alert('Insufficient Balance', `You need ₹${(orderTotal - balance).toFixed(0)} more to place this order.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Recharge Wallet', onPress: () => router.push('/(tabs)/wallet') },
      ]);
      return;
    }

    setPlacing(true);
    try {
      const { data } = await api.post('/orders', {
        canteenId,
        items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        specialInstructions: specialInstructions.trim() || undefined,
      });
      clear();
      router.replace(`/order/${data.order.id}`);
    } catch (err: any) {
      const errorData = err.response?.data;
      if (errorData?.currentBalance !== undefined) {
        Alert.alert('Insufficient Balance', `Wallet: ₹${Number(errorData.currentBalance).toFixed(2)}\nRequired: ₹${Number(errorData.required).toFixed(2)}`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Recharge', onPress: () => router.push('/(tabs)/wallet') },
        ]);
      } else {
        Alert.alert('Order Failed', errorData?.error || 'Something went wrong');
      }
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

      {/* Special Instructions */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Special Instructions</Text>
        <TextInput
          value={specialInstructions}
          onChangeText={setSpecialInstructions}
          placeholder="e.g., less spicy, no onion…"
          placeholderTextColor="#aaa"
          multiline
          style={styles.instructionsInput}
        />
      </View>

      {/* Wallet balance */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.walletRow}>
          <Text style={styles.walletLabel}>💰 Wallet Balance</Text>
          <Text style={[styles.walletBalance, !hasEnough && styles.walletLow]}>
            ₹{balance.toFixed(2)}
          </Text>
        </View>
        {!hasEnough && (
          <View style={styles.insufficientBox}>
            <Text style={styles.insufficientText}>
              Need ₹{(orderTotal - balance).toFixed(0)} more.{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/wallet')}>
              <Text style={styles.rechargeLink}>Recharge wallet →</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Text style={styles.etaText}>Estimated time: 15–20 min after vendor accepts</Text>

      <TouchableOpacity
        style={[styles.placeBtn, (!hasEnough || placing) && styles.placeBtnDisabled]}
        onPress={handlePlaceOrder}
        disabled={!hasEnough || placing}>
        {placing
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.placeBtnText}>Pay ₹{orderTotal.toFixed(0)} & Order</Text>}
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
  instructionsInput: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 10, fontSize: 14, color: '#333', minHeight: 60, textAlignVertical: 'top' },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletLabel: { fontSize: 14, color: '#555' },
  walletBalance: { fontSize: 16, fontWeight: '700', color: '#10b981' },
  walletLow: { color: '#ef4444' },
  insufficientBox: { flexDirection: 'row', alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
  insufficientText: { fontSize: 13, color: '#ef4444' },
  rechargeLink: { fontSize: 13, color: '#e94560', fontWeight: '600' },
  etaText: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 12 },
  placeBtn: { backgroundColor: '#e94560', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 32 },
  placeBtnDisabled: { opacity: 0.5 },
  placeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
