import { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import api from '../../services/api';

const REDEMPTION_TIERS = [
  { points: 200,  discount: 20  },
  { points: 500,  discount: 60  },
  { points: 1000, discount: 120 },
];

const TX_COLOR: Record<string, string> = { EARNED: '#10b981', REDEEMED: '#ef4444', EXPIRED: '#9ca3af', BONUS: '#8b5cf6' };

export default function RewardsScreen() {
  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLoyalty(); }, []);

  async function loadLoyalty() {
    try {
      const { data } = await api.get('/loyalty');
      setAccount(data.account);
    } catch { /* ignore */ }
    setLoading(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa' }}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  const totalPoints = account?.totalPoints || 0;
  const lifetimePoints = account?.lifetimePoints || 0;
  const totalSaved = Number(account?.totalSaved || 0);
  const transactions = account?.transactions || [];

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      {/* Points card */}
      <View style={styles.pointsCard}>
        <Text style={styles.pointsLabel}>Your Points</Text>
        <Text style={styles.pointsValue}>{totalPoints}</Text>
        <Text style={styles.pointsSub}>
          {totalSaved > 0 ? `₹${totalSaved.toFixed(0)} saved lifetime` : 'Start ordering to earn points!'}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{lifetimePoints}</Text>
            <Text style={styles.statLabel}>Total Earned</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>₹{totalSaved.toFixed(0)}</Text>
            <Text style={styles.statLabel}>Saved</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={transactions}
        keyExtractor={t => t.id}
        ListHeaderComponent={() => (
          <>
            {/* Redemption tiers */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Redeem Your Points</Text>
              {REDEMPTION_TIERS.map(tier => {
                const canRedeem = totalPoints >= tier.points;
                const remaining = tier.points - totalPoints;
                return (
                  <View key={tier.points} style={[styles.tierCard, canRedeem && styles.tierCardActive]}>
                    <Text style={styles.tierIcon}>{canRedeem ? '✅' : '🔒'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tierTitle, !canRedeem && styles.tierTitleLocked]}>
                        {tier.points} pts → ₹{tier.discount} off
                      </Text>
                      {!canRedeem && (
                        <Text style={styles.tierAway}>{remaining} more points needed</Text>
                      )}
                      {canRedeem && (
                        <Text style={styles.tierReady}>Available at checkout</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Early bird tip */}
            <View style={styles.tipCard}>
              <Text style={styles.tipIcon}>🌅</Text>
              <Text style={styles.tipText}>Order before 9 AM = <Text style={{ fontWeight: '700' }}>2× points!</Text></Text>
            </View>

            <Text style={styles.activityTitle}>Recent Activity</Text>
          </>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No activity yet. Place your first order to earn points!</Text>}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        renderItem={({ item: t }) => {
          const isEarned = t.type === 'EARNED' || t.type === 'BONUS';
          return (
            <View style={styles.txCard}>
              <View style={[styles.txIconBox, { backgroundColor: isEarned ? '#dcfce7' : '#fef2f2' }]}>
                <Text style={{ fontSize: 16 }}>{isEarned ? '⭐' : '🎟️'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txDesc} numberOfLines={2}>{t.description}</Text>
                <Text style={styles.txDate}>{new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>
              </View>
              <Text style={[styles.txPoints, { color: TX_COLOR[t.type] || '#333' }]}>
                {t.points > 0 ? '+' : ''}{t.points} pts
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pointsCard: { backgroundColor: '#1a1a2e', margin: 16, borderRadius: 20, padding: 24, alignItems: 'center' },
  pointsLabel: { color: '#ffffff80', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  pointsValue: { color: '#fff', fontSize: 52, fontWeight: '900', marginVertical: 4 },
  pointsSub: { color: '#ffffff60', fontSize: 12, marginBottom: 16 },
  statsRow: { flexDirection: 'row', width: '100%' },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#ffffff60', fontSize: 11 },
  statDivider: { width: 1, backgroundColor: '#ffffff20' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 10 },
  tierCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: '#e5e7eb' },
  tierCardActive: { borderColor: '#10b981', backgroundColor: '#f0fdf4' },
  tierIcon: { fontSize: 20 },
  tierTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
  tierTitleLocked: { color: '#9ca3af' },
  tierAway: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  tierReady: { fontSize: 12, color: '#10b981', marginTop: 2 },
  tipCard: { backgroundColor: '#fef9c3', borderRadius: 12, padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#fde68a' },
  tipIcon: { fontSize: 24 },
  tipText: { fontSize: 13, color: '#78350f', flex: 1 },
  activityTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  txCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  txIconBox: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  txDesc: { fontSize: 13, color: '#333' },
  txDate: { fontSize: 11, color: '#aaa', marginTop: 2 },
  txPoints: { fontSize: 14, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 20 },
});
