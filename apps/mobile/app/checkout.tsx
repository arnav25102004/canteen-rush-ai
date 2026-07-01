import { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import RazorpayCheckout from 'react-native-razorpay';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';

const REDEMPTION_TIERS = [
  { points: 200, discount: 20 },
  { points: 500, discount: 60 },
  { points: 1000, discount: 120 },
];

export default function CheckoutScreen() {
  const router = useRouter();
  const { canteenId, canteenName, items, total, clear } = useCartStore();
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [placing, setPlacing] = useState(false);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [walletCredit, setWalletCredit] = useState(0);
  const [selectedPointsTier, setSelectedPointsTier] = useState<number>(0);

  const orderTotal = total();
  const pointsDiscount = REDEMPTION_TIERS.find(t => t.points === selectedPointsTier)?.discount || 0;
  const afterPoints = orderTotal - pointsDiscount;
  const walletApplied = Math.min(walletCredit, afterPoints);
  const amountDue = Math.max(0, afterPoints - walletApplied);

  useEffect(() => { loadLoyaltyAndWallet(); }, []);

  async function loadLoyaltyAndWallet() {
    try {
      const [loyaltyRes, walletRes] = await Promise.all([
        api.get('/loyalty').catch(() => ({ data: { account: { totalPoints: 0 } } })),
        api.get('/wallet').catch(() => ({ data: { wallet: { balance: 0 } } })),
      ]);
      setLoyaltyPoints(loyaltyRes.data.account?.totalPoints || 0);
      setWalletCredit(Number(walletRes.data.wallet?.balance || 0));
    } catch { /* ignore */ }
  }

  async function handlePlaceOrder() {
    if (!canteenId) return;
    setPlacing(true);
    try {
      // Step 1: Create order on backend (returns Razorpay order details if vendor uses Razorpay)
      const { data } = await api.post('/orders', {
        canteenId,
        items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity })),
        specialInstructions: specialInstructions.trim() || undefined,
        pointsToRedeem: selectedPointsTier || 0,
      });

      const orderId: string = data.order.id;

      // Step 2a: Free order (wallet/points fully cover it) — go straight to tracking
      if (amountDue === 0 || !data.razorpay) {
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
        name: 'CanteenRush',
        theme: { color: '#e94560' },
      });

      // Step 3: Payment captured — webhook updates the order in the background
      // Navigate to tracking screen; it polls for CONFIRMED status
      clear();
      router.replace({ pathname: '/order/[id]', params: { id: orderId } });

    } catch (error: any) {
      // Razorpay error code 2 = user dismissed the sheet — do nothing
      if (error?.code === 2) return;
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
            const canRedeem = loyaltyPoints >= tier.points;
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
                  <Text style={styles.tierAway}>{tier.points - loyaltyPoints} away</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Wallet Credit */}
      {walletCredit > 0 && (
        <View style={styles.walletCard}>
          <Text style={styles.walletIcon}>💰</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.walletTitle}>Wallet Credit — ₹{walletCredit.toFixed(0)} applying automatically</Text>
            <Text style={styles.walletSub}>From refunded orders</Text>
          </View>
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
              <Text style={styles.rowLabel}>Wallet credit applied</Text>
              <Text style={[styles.rowValue, { color: '#10b981' }]}>−₹{walletApplied.toFixed(0)}</Text>
            </View>
          )}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Amount Due</Text>
            <Text style={styles.totalAmount}>₹{amountDue.toFixed(0)}</Text>
          </View>
        </View>
      )}

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
          <Text style={styles.payIcon}>💵</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.payTitle}>Pay at Counter</Text>
            <Text style={styles.paySubtitle}>
              Show your pickup code and pay ₹{amountDue.toFixed(0)} in cash when you collect.
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.payCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
          <Text style={styles.payIcon}>✅</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.payTitle, { color: '#15803d' }]}>Fully covered by wallet/points</Text>
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
              {amountDue > 0 ? `Place Order — Pay ₹${amountDue.toFixed(0)} at Counter` : 'Place Order — Free'}
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
  walletCard: { backgroundColor: '#eff6ff', borderRadius: 14, padding: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#bfdbfe' },
  walletIcon: { fontSize: 28 },
  walletTitle: { fontSize: 14, fontWeight: '600', color: '#1e40af' },
  walletSub: { fontSize: 12, color: '#3b82f6', marginTop: 2 },
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
