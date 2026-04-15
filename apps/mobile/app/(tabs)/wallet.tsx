import { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, TextInput, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const TYPE_COLOR: Record<string, string> = { RECHARGE: '#10b981', DEBIT: '#ef4444', REFUND: '#3b82f6' };
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function WalletScreen() {
  const { user } = useAuthStore();
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showRecharge, setShowRecharge] = useState(false);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadWallet();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function loadWallet() {
    try {
      const [w, t] = await Promise.all([
        api.get('/wallet').then(r => r.data.wallet),
        api.get('/wallet/transactions').then(r => r.data.transactions || []),
      ]);
      setWallet(w);
      setTransactions(t);
    } catch { /* ignore */ }
  }

  async function recharge() {
    const n = parseFloat(amount);
    if (!n || n < 10) { Alert.alert('Minimum recharge is ₹10'); return; }

    setLoading(true);
    try {
      // 1. Create Razorpay order for wallet recharge
      const { data } = await api.post('/wallet/recharge', { amount: n });
      const { razorpayOrderId } = data;

      setShowRecharge(false);
      setAmount('');

      // 2. Open checkout page in system browser
      const url = `${BASE_URL}/api/payments/checkout?orderId=${razorpayOrderId}&amount=${n}&name=${encodeURIComponent(user?.name || 'Student')}&email=${encodeURIComponent(user?.email || '')}`;
      await WebBrowser.openBrowserAsync(url, {
        toolbarColor: '#1a1a2e',
        controlsColor: '#e94560',
      });

      // 3. Poll for payment confirmation
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const { data: s } = await api.get(`/payments/status/${razorpayOrderId}`);
          if (s.status === 'PAID') {
            clearInterval(pollRef.current!);
            // 4. Verify + credit wallet
            await api.post('/wallet/recharge/verify', {
              razorpayOrderId,
              razorpayPaymentId: s.paymentId,
              signature: s.signature,
              amount: n,
            });
            await loadWallet();
            setLoading(false);
            Alert.alert('Success', `₹${n.toFixed(0)} added to your wallet!`);
          } else if (s.status === 'FAILED' || attempts > 15) {
            clearInterval(pollRef.current!);
            setLoading(false);
            if (attempts > 15) Alert.alert('Timeout', 'Payment not confirmed. Contact support if money was deducted.');
          }
        } catch {
          if (attempts > 15) { clearInterval(pollRef.current!); setLoading(false); }
        }
      }, 1500);

    } catch (e: any) {
      setLoading(false);
      Alert.alert('Failed', e?.response?.data?.error || 'Could not initiate payment');
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
});
