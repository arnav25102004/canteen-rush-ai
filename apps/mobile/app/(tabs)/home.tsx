import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import api from '../../services/api';

interface Canteen {
  id: string; name: string; campus: string; location: string;
  imageUrl?: string; isActive: boolean; openingTime: string; closingTime: string;
  avgPrepTime: number; _count: { orders: number };
}

export default function HomeScreen() {
  const router = useRouter();
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [filtered, setFiltered] = useState<Canteen[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/canteens').then(r => {
      setCanteens(r.data.canteens || []);
      setFiltered(r.data.canteens || []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!search) { setFiltered(canteens); return; }
    setFiltered(canteens.filter(c => c.name.toLowerCase().includes(search.toLowerCase())));
  }, [search, canteens]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;

  return (
    <View style={styles.container}>
      <TextInput style={styles.search} placeholder="Search canteens..." value={search}
        onChangeText={setSearch} placeholderTextColor="#999" />

      <FlatList data={filtered} keyExtractor={c => c.id} contentContainerStyle={{ padding: 16 }}
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
        )} />
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
});
