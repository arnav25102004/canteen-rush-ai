import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../services/api';
import { useCartStore } from '../../store/cartStore';

interface MenuItem { id: string; name: string; price: number; description?: string; isVeg: boolean; isAvailable: boolean; isPopular: boolean; prepTimeMinutes: number; }
interface Category { id: string; name: string; items: MenuItem[]; }

export default function CanteenMenuScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addItem, itemCount, total, canteenId } = useCartStore();
  const [categories, setCategories] = useState<Category[]>([]);
  const [popular, setPopular] = useState<MenuItem[]>([]);
  const [canteen, setCanteen] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState('Popular');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/canteens/${id}`).then(r => setCanteen(r.data.canteen)),
      api.get(`/canteens/${id}/menu`).then(r => { setCategories(r.data.categories); setPopular(r.data.popular); }),
    ]).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;

  const allCats = [{ id: 'popular', name: 'Popular', items: popular }, ...categories];
  const currentItems = allCats.find(c => c.name === activeCategory)?.items || [];

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <View style={styles.header}>
        <Text style={styles.canteenName}>{canteen?.name}</Text>
        <Text style={styles.canteenMeta}>{canteen?.location} • {canteen?.openingTime}–{canteen?.closingTime}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
        {allCats.map(cat => (
          <TouchableOpacity key={cat.id} onPress={() => setActiveCategory(cat.name)}
            style={[styles.catChip, activeCategory === cat.name && styles.catChipActive]}>
            <Text style={[styles.catText, activeCategory === cat.name && styles.catTextActive]}>{cat.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList data={currentItems} keyExtractor={i => i.id} contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => <MenuItemCard item={item} canteenId={id!} canteenName={canteen?.name || ''} addItem={addItem} />}
      />

      {itemCount() > 0 && (
        <TouchableOpacity style={styles.cartBar} onPress={() => router.push('/cart')}>
          <Text style={styles.cartBarText}>{itemCount()} items</Text>
          <Text style={styles.cartBarText}>View Cart • ₹{total().toFixed(0)} →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function MenuItemCard({ item, canteenId, canteenName, addItem }: any) {
  return (
    <View style={[styles.itemCard, !item.isAvailable && { opacity: 0.5 }]}>
      <View style={styles.vegDot}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.isVeg ? '#16a34a' : '#dc2626' }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemName}>{item.name}</Text>
        {item.description ? <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text> : null}
        <Text style={styles.itemMeta}>⏱ {item.prepTimeMinutes} min</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Text style={styles.itemPrice}>₹{Number(item.price).toFixed(0)}</Text>
        {item.isAvailable ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => addItem(canteenId, canteenName, { menuItemId: item.id, name: item.name, price: Number(item.price), isVeg: item.isVeg })}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ fontSize: 11, color: '#dc2626' }}>Sold Out</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { backgroundColor: '#1a1a2e', padding: 20, paddingTop: 16 },
  canteenName: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  canteenMeta: { color: '#ffffff80', fontSize: 12, marginTop: 4 },
  catScroll: { backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 8, maxHeight: 60 },
  catChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginHorizontal: 4, backgroundColor: '#f1f5f9' },
  catChipActive: { backgroundColor: '#1a1a2e' },
  catText: { fontSize: 13, color: '#555' },
  catTextActive: { color: '#fff', fontWeight: '600' },
  itemCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  vegDot: { paddingTop: 2 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  itemDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  itemMeta: { fontSize: 11, color: '#aaa', marginTop: 4 },
  itemPrice: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  addBtn: { backgroundColor: '#e94560', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  cartBar: { backgroundColor: '#1a1a2e', margin: 12, borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'space-between' },
  cartBarText: { color: '#fff', fontWeight: '600' },
});
