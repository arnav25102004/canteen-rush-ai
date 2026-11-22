import { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { isAxiosError } from 'axios';
import RazorpayCheckout from 'react-native-razorpay';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';
import SlotPicker from '../components/SlotPicker';

const REDEMPTION_TIERS = [
  { points: 200, discount: 20 },
  { points: 500, discount: 60 },
  { points: 1000, discount: 120 },
];

// Identifies one checkout attempt so a retried request cannot place a second order.
const newRequestId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });

export default function CheckoutScreen() {
  const router = useRouter();
  const { canteenId, canteenName, items, total, clear, slot, setSlot } = useCartStore();
  const [slotRefresh, setSlotRefresh] = useState(0);
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [placing, setPlacing] = useState(false);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [selectedPointsTier, setSelectedPointsTier] = useState<number>(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [payOnline, setPayOnline] = useState(false);
  const [expiredAttempts, setExpiredAttempts] = useState(0);

  const orderTotal = total();
  const pointsDiscount = REDEMPTION_TIERS.find(t => t.points === selectedPointsTier)?.discount || 0;
  const afterPoints = Math.max(0, orderTotal - pointsDiscount);
  // The server applies wallet credit automatically, so the amount shown must include it.
  const walletApplied = Math.min(walletBalance, afterPoints);
  const amountDue = afterPoints - walletApplied;
  // A changed cart, slot or discount is a new order; an unchanged retry keeps the same id.
  const attemptKey = JSON.stringify([canteenId, slot?.id, selectedPointsTier, items.map(i => [i.menuItemId, i.quantity]), expiredAttempts]);
  const clientRequestId = useMemo(newRequestId, [attemptKey]);

  useEffect(() => {
    api.get('/loyalty').then(r => setLoyaltyPoints(r.data.account?.totalPoints || 0)).catch(() => null);
    api.get('/wallet').then(r => setWalletBalance(Number(r.data.wallet?.balance ?? 0))).catch(() => null);
    if (canteenId) api.get(`/canteens/${canteenId}`).then(r => setPayOnline(!!r.data.canteen?.onlinePaymentEnabled)).catch(() => null);
  }, [canteenId]);

  async function handlePlaceOrder() {
    if (!canteenId) return;
    setPlacing(true);
    try {
      // Step 1: Create order on backend (returns Razorpay order details if vendor uses Razorpay)
      const { data } = await api.post('/orders', {
        canteenId,
        items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        slotId: slot?.id,
        specialInstructions: specialInstructions.trim() || undefined,
        pointsToRedeem: selectedPointsTier || 0,
        clientRequestId,
      });

      const orderId: string = data.order.id;

      // A retry of an attempt that has since expired: keep the cart and start a new attempt.
      if (['CANCELLED', 'NO_SHOW'].includes(data.order.status)) {
        setExpiredAttempts((n) => n + 1);
        Alert.alert('Order expired', 'Your previous attempt expired. Tap Place Order to try again.');
        return;
      }

      // Step 2a: Nothing to pay online (counter, wallet or points) — go straight to tracking
      if (!data.razorpay) {
        clear();
        router.replace({ pathname: '/order/[id]', params: { id: orderId } });
        return;
      }

      // Step 2b: Open Razorpay payment sheet
      const { razorpay } = data as {
        razorpay: { orderId: string; amount: number; currency: string; keyId: string };
      };

      await RazorpayCheckout.open({
        description: `Order at ${canteenName}`,
        currency: razorpay.currency,
        key: razorpay.keyId,
        amount: String(razorpay.amount),   // paise
        order_id: razorpay.orderId,
        name: 'Campus Khana',
        theme: { color: '#e94560' },
      });

      // Step 3: Payment captured — webhook updates the order in the background
      // Navigate to tracking screen; it polls for CONFIRMED status
      clear();
      router.replace({ pathname: '/order/[id]', params: { id: orderId } });

    } catch (error: any) {
      // Razorpay error code 2 = user dismissed the sheet — do nothing
      if (error?.code === 2) return;
      if (isAxiosError<{ error?: string }>(error)) {
        // Server-provided message (e.g. strike ban, closed canteen); generic fallback for network/5xx.
        const msg = error.response?.status && error.response.status < 500 ? error.response.data?.error : undefined;
        // The chosen pickup time may have filled up or closed: clear it and reload the list.
        if (slot && error.response?.status === 400 && /slot|pickup|cutoff|full|closed/i.test(msg || '')) {
          setSlot(null);
          setSlotRefresh((n) => n + 1);
        }
        Alert.alert('Could not place order', msg || 'Something went wrong. Please try again.');
        return;
      }
      Alert.alert('Payment Failed', error?.description || error?.message || 'Something went wrong. Please try again.');
    } finally {
      setPlacing(false);
    }
  }

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
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalAmount}>₹{orderTotal.toFixed(0)}</Text>
        </View>
      </View>

      {/* Points Redemption */}
      {loyaltyPoints >= 200 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Redeem Points</Text>
          <Text style={styles.pointsBalance}>You have {loyaltyPoints} points</Text>
          {REDEMPTION_TIERS.map(tier => {
            const hasPoints = loyaltyPoints >= tier.points;
            const canRedeem = hasPoints && tier.discount <= orderTotal; // the server rejects a larger discount
            const isSelected = selectedPointsTier === tier.points;
            return (
              <TouchableOpacity
                key={tier.points}
                style={[styles.tierRow, isSelected && styles.tierRowSelected, !canRedeem && styles.tierRowDisabled]}
                onPress={() => canRedeem && setSelectedPointsTier(isSelected ? 0 : tier.points)}
                disabled={!canRedeem}>
                <Text style={[styles.tierLabel, !canRedeem && styles.tierLabelDisabled]}>
                  {canRedeem ? '✅' : '🔒'} {tier.points} pts → ₹{tier.discount} off
                </Text>
                {!canRedeem && (
                  <Text style={styles.tierAway}>{hasPoints ? `Order ₹${tier.discount}+` : `${tier.points - loyaltyPoints} away`}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Discount summary */}
      {(pointsDiscount > 0 || walletApplied > 0) && (
        <View style={styles.card}>
          {pointsDiscount > 0 && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Points discount ({selectedPointsTier} pts)</Text>
              <Text style={[styles.rowValue, { color: '#10b981' }]}>−₹{pointsDiscount}</Text>
            </View>
          )}
          {walletApplied > 0 && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Wallet credit</Text>
              <Text style={[styles.rowValue, { color: '#10b981' }]}>−₹{walletApplied.toFixed(0)}</Text>
            </View>
          )}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Amount Due</Text>
            <Text style={styles.totalAmount}>₹{amountDue.toFixed(0)}</Text>
          </View>
        </View>
      )}

      {/* Pickup time */}
      {canteenId && <SlotPicker canteenId={canteenId} value={slot} onChange={setSlot} refreshKey={slotRefresh} />}

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

      {/* Payment info */}
      {amountDue > 0 ? (
        <View style={styles.payCard}>
          <Text style={styles.payIcon}>{payOnline ? '💳' : '💵'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.payTitle}>{payOnline ? 'Pay Online' : 'Pay at Counter'}</Text>
            <Text style={styles.paySubtitle}>
              {payOnline
                ? `Pay ₹${amountDue.toFixed(0)} securely on the next step.`
                : `Show your pickup code and pay ₹${amountDue.toFixed(0)} in cash when you collect.`}
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.payCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
          <Text style={styles.payIcon}>✅</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.payTitle, { color: '#15803d' }]}>Fully covered by wallet and points</Text>
            <Text style={[styles.paySubtitle, { color: '#166534' }]}>No payment needed</Text>
          </View>
        </View>
      )}

      <Text style={styles.etaText}>Estimated time: 15–20 min after order is confirmed</Text>

      <TouchableOpacity
        style={[styles.placeBtn, placing && styles.placeBtnDisabled]}
        onPress={handlePlaceOrder}
        disabled={placing}>
        {placing
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.placeBtnText}>
              {amountDue > 0 ? `Place Order — Pay ₹${amountDue.toFixed(0)}${payOnline ? '' : ' at Counter'}` : 'Place Order — Nothing to Pay'}
            </Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  pointsBalance: { fontSize: 13, color: '#888', marginBottom: 10 },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 8 },
  tierRowSelected: { borderColor: '#e94560', backgroundColor: '#fff1f2' },
  tierRowDisabled: { opacity: 0.5 },
  tierLabel: { fontSize: 14, color: '#333', fontWeight: '500' },
  tierLabelDisabled: { color: '#aaa' },
  tierAway: { fontSize: 12, color: '#aaa' },
  instructionsInput: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 10, fontSize: 14, color: '#333', minHeight: 60, textAlignVertical: 'top' },
  payCard: { backgroundColor: '#faf5ff', borderRadius: 14, padding: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#e9d5ff' },
  payIcon: { fontSize: 32 },
  payTitle: { fontSize: 15, fontWeight: '700', color: '#7e22ce', marginBottom: 2 },
  paySubtitle: { fontSize: 12, color: '#6b21a8' },
  etaText: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 12 },
  placeBtn: { backgroundColor: '#e94560', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 32 },
  placeBtnDisabled: { opacity: 0.5 },
  placeBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
