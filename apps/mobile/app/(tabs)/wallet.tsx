import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, TextInput, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const TYPE_COLOR: Record<string, string> = { RECHARGE: '#10b981', DEBIT: '#ef4444', REFUND: '#3b82f6' };

export default function WalletScreen() {
  const { user } = useAuthStore();
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [spendingSummary, setSpendingSummary] = useState<{ totalSpent: number; transactionCount: number } | null>(null);
  const [showRecharge, setShowRecharge] = useState(false);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadWallet(); }, []);

  async function loadWallet() {
    try {
      const [w, t, s] = await Promise.all([
        api.get('/wallet').then(r => r.data.wallet),
        api.get('/wallet/transactions').then(r => r.data.transactions || []),
        api.get('/wallet/spending-summary').then(r => r.data).catch(() => null),
      ]);
      setWallet(w);
      setTransactions(t);
      if (s) setSpendingSummary({ totalSpent: s.totalSpent, transactionCount: s.transactionCount });
    } catch { /* ignore */ }
  }

  async function recharge() {
    const n = parseFloat(amount);
    if (!n || n < 50) { Alert.alert('Minimum recharge is ₹50'); return; }
    if (n > 5000) { Alert.alert('Maximum recharge is ₹5000'); return; }

    setShowRecharge(false);
    setAmount('');
    setLoading(true);

    try {
      // 1. Create Razorpay order
      const { data } = await api.post('/wallet/recharge', { amount: n });
      const { razorpayOrderId, keyId } = data;

      // 2. Open native Razorpay checkout
      if (!(RazorpayCheckout as any)?.open) {
        Alert.alert('Dev Build Required', 'Run "npx expo run:android" to use Razorpay. Expo Go does not support native payment modules.');
        setLoading(false);
        return;
      }
      const paymentData: any = await (RazorpayCheckout as any).open({
        key: keyId,
        amount: String(Math.round(n * 100)),
        order_id: razorpayOrderId,
        currency: 'INR',
        name: 'ChristEats',
        description: 'Wallet Recharge',
        prefill: { name: user?.name || '', email: user?.email || '' },
        theme: { color: '#e94560' },
      });

      // 3. Verify + credit wallet
      await api.post('/wallet/recharge/verify', {
        razorpayOrderId: paymentData.razorpay_order_id,
        razorpayPaymentId: paymentData.razorpay_payment_id,
        signature: paymentData.razorpay_signature,
        amount: n,
      });

      await loadWallet();
      Alert.alert('Success', `₹${n.toFixed(0)} added to your wallet!`);
    } catch (e: any) {
      const code = e?.code || e?.error?.code;
      if (code === 'PAYMENT_CANCELLED' || code === 0) return; // user dismissed
      console.error('Razorpay error:', JSON.stringify(e));
      Alert.alert('Payment Failed', e?.response?.data?.error || e?.error?.description || e?.description || e?.message || 'Could not complete payment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.loadingText}>Processing payment…</Text>
        </View>
      )}

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Wallet Balance</Text>
        <Text style={styles.balance}>₹{Number(wallet?.balance || 0).toFixed(2)}</Text>
        <TouchableOpacity style={styles.rechargeBtn} onPress={() => setShowRecharge(true)}>
          <Text style={styles.rechargeBtnText}>+ Recharge</Text>
        </TouchableOpacity>
      </View>

      {spendingSummary !== null && (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>This Month</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>₹{Number(spendingSummary.totalSpent).toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Spent</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{spendingSummary.transactionCount}</Text>
              <Text style={styles.summaryLabel}>Orders</Text>
            </View>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Transaction History</Text>
      <FlatList data={transactions} keyExtractor={t => t.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No transactions yet</Text>}
        renderItem={({ item: t }) => (
          <View style={styles.txCard}>
            <View style={styles.txIcon}>
              <Text style={{ fontSize: 18 }}>{t.type === 'RECHARGE' ? '↑' : t.type === 'REFUND' ? '↺' : '↓'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.txDesc}>{t.description || t.type}</Text>
              <Text style={styles.txDate}>{new Date(t.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={[styles.txAmount, { color: TYPE_COLOR[t.type] }]}>
              {t.type === 'DEBIT' ? '-' : '+'}₹{Number(t.amount).toFixed(0)}
            </Text>
          </View>
        )} />

      <Modal visible={showRecharge} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Recharge Wallet</Text>
            <TextInput style={styles.modalInput} keyboardType="numeric" placeholder="Enter amount (₹)"
              value={amount} onChangeText={setAmount} placeholderTextColor="#aaa" />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              {[50, 100, 200, 500].map(v => (
                <TouchableOpacity key={v} style={styles.quickAmt} onPress={() => setAmount(String(v))}>
                  <Text style={{ fontSize: 12, color: '#555' }}>₹{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.modalBtn} onPress={recharge} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Proceed to Pay</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowRecharge(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#ffffffcc', justifyContent: 'center', alignItems: 'center', zIndex: 99 },
  loadingText: { marginTop: 12, color: '#555', fontSize: 14 },
  balanceCard: { backgroundColor: '#1a1a2e', margin: 16, borderRadius: 20, padding: 24, alignItems: 'center' },
  balanceLabel: { color: '#ffffff80', fontSize: 14 },
  balance: { color: '#fff', fontSize: 42, fontWeight: 'bold', marginVertical: 8 },
  rechargeBtn: { backgroundColor: '#e94560', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 8 },
  rechargeBtnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginHorizontal: 16, marginBottom: 8 },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 30 },
  txCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  txIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  txDesc: { fontSize: 13, color: '#333' },
  txDate: { fontSize: 11, color: '#aaa', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, fontSize: 18, color: '#333', marginBottom: 12 },
  quickAmt: { flex: 1, backgroundColor: '#f1f5f9', padding: 8, borderRadius: 8, alignItems: 'center' },
  modalBtn: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  modalBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  cancelText: { textAlign: 'center', color: '#999', marginTop: 12 },
  summaryCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 14, padding: 16, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#1a1a2e' },
  summaryLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  summaryDivider: { width: 1, height: 40, backgroundColor: '#f0f0f0' },
});
