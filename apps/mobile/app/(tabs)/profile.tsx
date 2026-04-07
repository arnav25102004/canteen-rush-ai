import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuthStore } from '../../store/authStore';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();

  const items = [
    { label: 'Name', value: user?.name },
    { label: 'Email', value: user?.email },
    { label: 'Campus', value: user?.campus || 'Not set' },
    { label: 'Diet Preference', value: user?.dietPreference || 'Not set' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#f8f9fa' }}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || '?'}</Text>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
      </View>

      <View style={styles.section}>
        {items.map(item => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>🚪 Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: '#1a1a2e', padding: 32, alignItems: 'center' },
  avatarText: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#e94560', textAlign: 'center', lineHeight: 72, fontSize: 30, fontWeight: 'bold', color: '#fff' },
  userName: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 12 },
  userEmail: { color: '#ffffff80', fontSize: 13, marginTop: 4 },
  section: { backgroundColor: '#fff', margin: 16, borderRadius: 14, overflow: 'hidden', elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rowLabel: { color: '#888', fontSize: 14 },
  rowValue: { color: '#333', fontSize: 14, fontWeight: '500' },
  logoutBtn: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', elevation: 1 },
  logoutText: { color: '#ef4444', fontWeight: '600' },
});
