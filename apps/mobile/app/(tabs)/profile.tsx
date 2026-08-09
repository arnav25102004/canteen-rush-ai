import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface FavoriteItem { id: string; name: string; price: number; isVeg: boolean; canteen: { id: string; name: string } }

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loadingFavs, setLoadingFavs] = useState(true);

  useEffect(() => {
    api.get('/menu/favorites').then(r => setFavorites(r.data.favorites || [])).catch(() => null).finally(() => setLoadingFavs(false));
  }, []);

  async function removeFavorite(menuItemId: string) {
    setFavorites(prev => prev.filter(f => f.id !== menuItemId));
    await api.delete(`/menu/favorites/${menuItemId}`).catch(() => null);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all personal data. Your order history will be anonymised. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/user/account');
              await logout();
              router.replace('/(auth)/login');
            } catch (err) {
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            }
          },
        },
      ]
    );
  }

  const isFaculty = user?.role === 'FACULTY';

  const infoItems = [
    { label: 'Name', value: user?.name },
    { label: 'Email', value: user?.email },
    { label: 'Campus', value: user?.campus || 'Not set' },
    { label: 'Diet Preference', value: user?.dietPreference || 'Not set' },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || '?'}</Text>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        {isFaculty && (
          <View style={styles.facultyBadge}>
            <Text style={styles.facultyBadgeText}>Faculty · Priority Slots</Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        {infoItems.map(item => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Favorites</Text>
      </View>
      {loadingFavs
        ? <ActivityIndicator style={{ margin: 16 }} color="#e94560" />
        : favorites.length === 0
          ? <Text style={styles.empty}>No favorites yet. Tap ♡ on any menu item.</Text>
          : favorites.map(fav => (
            <View key={fav.id} style={styles.favCard}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fav.isVeg ? '#16a34a' : '#dc2626', marginTop: 4 }} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.favName}>{fav.name}</Text>
                <Text style={styles.favCanteen}>{fav.canteen?.name} • ₹{Number(fav.price).toFixed(0)}</Text>
              </View>
              <TouchableOpacity onPress={() => router.push(`/canteen/${fav.canteen?.id}`)}>
                <Text style={styles.favOrder}>Order →</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeFavorite(fav.id)} style={{ marginLeft: 12 }}>
                <Text style={{ color: '#e94560', fontSize: 18 }}>♥</Text>
              </TouchableOpacity>
            </View>
          ))
      }

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.privacyBtn}
        onPress={() => Linking.openURL('https://arnavnarula.dev/privacy.html')}
      >
        <Text style={styles.privacyBtnText}>Privacy Policy</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount}>
        <Text style={styles.deleteBtnText}>Delete Account & Data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: '#1a1a2e', padding: 32, alignItems: 'center' },
  avatarText: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#e94560', textAlign: 'center', lineHeight: 72, fontSize: 30, fontWeight: 'bold', color: '#fff' },
  userName: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 12 },
  userEmail: { color: '#ffffff80', fontSize: 13, marginTop: 4 },
  facultyBadge: { backgroundColor: '#f59e0b', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginTop: 10 },
  facultyBadgeText: { color: '#1a1a2e', fontSize: 11, fontWeight: '700' },
  section: { backgroundColor: '#fff', margin: 16, borderRadius: 14, overflow: 'hidden', elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rowLabel: { color: '#888', fontSize: 14 },
  rowValue: { color: '#333', fontSize: 14, fontWeight: '500' },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  empty: { textAlign: 'center', color: '#aaa', margin: 16, fontSize: 13 },
  favCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  favName: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  favCanteen: { fontSize: 12, color: '#888', marginTop: 2 },
  favOrder: { fontSize: 13, color: '#e94560', fontWeight: '600' },
  logoutBtn: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', elevation: 1, marginTop: 20, marginBottom: 8 },
  logoutText: { color: '#ef4444', fontWeight: '600' },
  privacyBtn: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 14, alignItems: 'center' },
  privacyBtnText: { color: '#888', fontSize: 13, fontWeight: '500', textDecorationLine: 'underline' },
  deleteBtn: { marginHorizontal: 16, marginBottom: 40, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#fca5a5' },
  deleteBtnText: { color: '#dc2626', fontSize: 13 },
});
