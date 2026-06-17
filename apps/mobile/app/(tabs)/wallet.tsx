import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import api from '../../services/api';

const TYPE_COLOR: Record<string, string> = { RECHARGE: '#10b981', DEBIT: '#ef4444', REFUND: '#3b82f6', CREDIT: '#8b5cf6' };
const TYPE_ICON: Record<string, string> = { RECHARGE: '↑', DEBIT: '↓', REFUND: '↺', CREDIT: '↑' };

export default function WalletScreen() {
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [spendingSummary, setSpendingSummary] = useState<{ totalSpent: number; transactionCount: number } | null>(null);

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

  const balance = Number(wallet?.balance || 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Wallet Credit</Text>
        <Text style={styles.balance}>₹{balance.toFixed(2)}</Text>
        <Text style={styles.balanceSub}>
          {balance > 0
            ? 'Applied automatically to your next order'
            : 'Refunds from cancelled orders appear here'}
        </Text>
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
      <FlatList
        data={transactions}
        keyExtractor={t => t.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No transactions yet</Text>}
        renderItem={({ item: t }) => (
          <View style={styles.txCard}>
            <View style={styles.txIcon}>
              <Text style={{ fontSize: 18 }}>{TYPE_ICON[t.type] || '·'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.txDesc}>{t.description || t.type}</Text>
              <Text style={styles.txDate}>{new Date(t.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={[styles.txAmount, { color: TYPE_COLOR[t.type] || '#333' }]}>
              {t.type === 'DEBIT' ? '-' : '+'}₹{Number(t.amount).toFixed(0)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  balanceCard: { backgroundColor: '#1a1a2e', margin: 16, borderRadius: 20, padding: 28, alignItems: 'center' },
  balanceLabel: { color: '#ffffff80', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  balance: { color: '#fff', fontSize: 48, fontWeight: 'bold', marginVertical: 8 },
  balanceSub: { color: '#ffffff60', fontSize: 12, textAlign: 'center', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginHorizontal: 16, marginBottom: 8 },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 30 },
  txCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  txIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  txDesc: { fontSize: 13, color: '#333' },
  txDate: { fontSize: 11, color: '#aaa', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
  summaryCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 14, padding: 16, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#1a1a2e' },
  summaryLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  summaryDivider: { width: 1, height: 40, backgroundColor: '#f0f0f0' },
});
