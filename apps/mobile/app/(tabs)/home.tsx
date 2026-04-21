import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import api from '../../services/api';
import { useCartStore } from '../../store/cartStore';

interface Canteen {
  id: string; name: string; campus: string; location: string;
  imageUrl?: string; isActive: boolean; openingTime: string; closingTime: string;
  avgPrepTime: number; _count: { orders: number };
}

interface LastOrder {
  id: string;
  canteen: { id: string; name: string; isActive: boolean };
  items: Array<{ menuItemId: string; quantity: number; menuItem: { id: string; name: string; price: string; isAvailable: boolean; isVeg?: boolean } }>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { addItem, clear } = useCartStore();
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [filtered, setFiltered] = useState<Canteen[]>([]);
  const [search, setSearch] = useState('');
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/canteens').then(r => {
        setCanteens(r.data.canteens || []);
        setFiltered(r.data.canteens || []);
      }),
      api.get('/orders/last-order').then(r => setLastOrder(r.data.order)).catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!search) { setFiltered(canteens); return; }
    setFiltered(canteens.filter(c => c.name.toLowerCase().includes(search.toLowerCase())));
  }, [search, canteens]);

  function reorderLast() {
    if (!lastOrder) return;
    if (!lastOrder.canteen.isActive) {
      Alert.alert('Canteen Closed', 'This canteen is currently not accepting orders.');
      return;
    }
    const unavailable = lastOrder.items.filter(i => !i.menuItem.isAvailable);
    if (unavailable.length > 0) {
      Alert.alert('Items Unavailable', `${unavailable.map(i => i.menuItem.name).join(', ')} ${unavailable.length > 1 ? 'are' : 'is'} no longer available.`);
      return;
    }
    clear();
    lastOrder.items.forEach(i => {
      addItem(lastOrder.canteen.id, lastOrder.canteen.name, {
        menuItemId: i.menuItem.id,
        name: i.menuItem.name,
        price: Number(i.menuItem.price),
        isVeg: i.menuItem.isVeg ?? true,
      });
      // Adjust quantity if > 1
      if (i.quantity > 1) {
        useCartStore.getState().updateQty(i.menuItem.id, i.quantity);
      }
    });
    router.push('/checkout');
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;

  return (
    <View style={styles.container}>
      <TextInput style={styles.search} placeholder="Search canteens..." value={search}
        onChangeText={setSearch} placeholderTextColor="#999" />

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={lastOrder ? (
          <View style={styles.reorderCard}>
            <View style={styles.reorderHeader}>
              <Text style={styles.reorderTitle}>Your Usual</Text>
              <Text style={styles.reorderCanteen}>{lastOrder.canteen.name}</Text>
            </View>
            <Text style={styles.reorderItems} numberOfLines={1}>
              {lastOrder.items.map(i => `${i.menuItem.name} ×${i.quantity}`).join(', ')}
            </Text>
            <TouchableOpacity style={styles.reorderBtn} onPress={reorderLast}>
              <Text style={styles.reorderBtnText}>Reorder →</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        renderItem={({ item: c }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push(`/canteen/${c.id}`)}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.canteenName}>{c.name}</Text>
                <Text style={styles.canteenMeta}>{c.location} • {c.campus}</Text>
                <Text style={styles.canteenMeta}>⏰ {c.openingTime}–{c.closingTime} • ~{c.avgPrepTime} min prep</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: c.isActive ? '#dcfce7' : '#fee2e2' }]}>
                <Text style={{ fontSize: 10, color: c.isActive ? '#16a34a' : '#dc2626', fontWeight: '600' }}>
                  {c.isActive ? 'Open' : 'Closed'}
                </Text>
              </View>
            </View>
            {c._count.orders > 0 && (
              <Text style={styles.queueText}>👥 {c._count.orders} active orders</Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  search: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  canteenName: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  canteenMeta: { fontSize: 12, color: '#666', marginBottom: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  queueText: { fontSize: 12, color: '#f59e0b', marginTop: 8 },
  reorderCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, marginBottom: 16 },
  reorderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reorderTitle: { fontSize: 12, fontWeight: '700', color: '#ffffff80', textTransform: 'uppercase', letterSpacing: 0.5 },
  reorderCanteen: { fontSize: 12, color: '#e94560', fontWeight: '600' },
  reorderItems: { fontSize: 14, color: '#ffffffcc', marginBottom: 12 },
  reorderBtn: { backgroundColor: '#e94560', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  reorderBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
