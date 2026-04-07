import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import api from '../../services/api';

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: '#f59e0b', ACCEPTED: '#3b82f6', PREPARING: '#f97316', READY: '#10b981', PICKED_UP: '#9ca3af', CANCELLED: '#ef4444',
};

export default function OrdersScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get('/orders');
    setOrders(data.orders || []);
  }, []);

  useEffect(() => { load(); }, [load]);

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
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[o.status] + '20' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLOR[o.status] }]}>{o.status}</Text>
              </View>
            </View>
            <Text style={styles.canteenName}>{o.canteen?.name}</Text>
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
