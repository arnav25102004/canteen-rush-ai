import { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../services/api';
import { getReviewedOrderIds } from '../../services/feedback';
import { ReviewChip } from '../../components/feedback/ReviewEntry';

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: '#f59e0b', ACCEPTED: '#3b82f6', PREPARING: '#f97316', READY: '#10b981', PICKED_UP: '#9ca3af', CANCELLED: '#ef4444', NO_SHOW: '#9ca3af',
};

function statusLabel(o: { status: string; cancelReason?: string | null }): string {
  if (o.status === 'NO_SHOW') return o.cancelReason?.startsWith('Expired') ? 'Expired' : 'No-show';
  return o.status;
}

export default function OrdersScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewed, setReviewed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/orders');
      setOrders(data.orders || []);
      // Best effort: without it the chip just shows "Rate" and the server answers if already reviewed.
      getReviewedOrderIds().then(setReviewed).catch(() => {});
    } catch { /* keep the last list; pull to refresh retries */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <FlatList data={orders} keyExtractor={o => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No orders yet. Go order something! 🍽️</Text>}
        renderItem={({ item: o }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/order/${o.id}`)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.orderNum}>{o.orderNumber}</Text>
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[o.status] ?? '#9ca3af') + '20' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLOR[o.status] ?? '#9ca3af' }]}>{statusLabel(o)}</Text>
              </View>
            </View>
            <Text style={styles.canteenName}>{o.canteen?.name}</Text>
            {o.status === 'PICKED_UP' && (
              <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                <ReviewChip orderId={o.id} orderNumber={o.orderNumber} pickedUpAt={o.pickedUpAt} reviewed={!!reviewed[o.id]} />
              </View>
            )}
            <Text style={styles.items} numberOfLines={1}>{o.items?.map((i: any) => `${i.menuItem.name} ×${i.quantity}`).join(', ')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={styles.meta}>{new Date(o.createdAt).toLocaleDateString()}</Text>
              <Text style={styles.amount}>₹{Number(o.totalAmount).toFixed(0)}</Text>
            </View>
          </TouchableOpacity>
        )} />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', color: '#999', marginTop: 60, fontSize: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6 },
  orderNum: { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '600' },
  canteenName: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 4 },
  items: { fontSize: 12, color: '#888' },
  meta: { fontSize: 12, color: '#aaa' },
  amount: { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
});
