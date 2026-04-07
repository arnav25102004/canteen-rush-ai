import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useCartStore } from '../store/cartStore';

export default function CartScreen() {
  const router = useRouter();
  const { items, canteenName, updateQty, removeItem, total, clear } = useCartStore();

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>🛒</Text>
        <Text style={styles.emptyText}>Your cart is empty</Text>
        <TouchableOpacity style={styles.browseBtn} onPress={() => router.back()}>
          <Text style={styles.browseBtnText}>Browse Menu</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Your Cart</Text>
          <Text style={styles.headerSub}>{canteenName}</Text>
        </View>
        <TouchableOpacity onPress={() => { Alert.alert('Clear Cart', 'Remove all items?', [{ text: 'Cancel' }, { text: 'Clear', style: 'destructive', onPress: () => { clear(); router.back(); } }]); }}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.menuItemId}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.vegDot}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.isVeg ? '#16a34a' : '#dc2626' }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>₹{item.price.toFixed(0)}</Text>
            </View>
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.menuItemId, item.quantity - 1)}>
                <Text style={styles.qtyBtnText}>{item.quantity === 1 ? '🗑' : '−'}</Text>
              </TouchableOpacity>
              <Text style={styles.qty}>{item.quantity}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.menuItemId, item.quantity + 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.lineTotal}>₹{(item.price * item.quantity).toFixed(0)}</Text>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalAmount}>₹{total().toFixed(0)}</Text>
        </View>
        <TouchableOpacity style={styles.checkoutBtn} onPress={() => router.push('/checkout')}>
          <Text style={styles.checkoutBtnText}>Proceed to Checkout →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 18, color: '#888', marginBottom: 20 },
  browseBtn: { backgroundColor: '#e94560', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  browseBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  header: { backgroundColor: '#1a1a2e', padding: 20, paddingTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { padding: 4 },
  backText: { color: '#fff', fontSize: 24 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSub: { color: '#ffffff80', fontSize: 12, marginTop: 2 },
  clearText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  itemCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  vegDot: { paddingTop: 2 },
  itemName: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  itemPrice: { fontSize: 13, color: '#888', marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { fontSize: 14, color: '#333' },
  qty: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', minWidth: 20, textAlign: 'center' },
  lineTotal: { fontSize: 14, fontWeight: '700', color: '#1a1a2e', minWidth: 40, textAlign: 'right' },
  footer: { backgroundColor: '#fff', padding: 20, elevation: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  totalLabel: { fontSize: 16, fontWeight: '600', color: '#333' },
  totalAmount: { fontSize: 20, fontWeight: 'bold', color: '#1a1a2e' },
  checkoutBtn: { backgroundColor: '#e94560', borderRadius: 14, padding: 16, alignItems: 'center' },
  checkoutBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
