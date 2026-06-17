import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import api from '../services/api';
import { useAuthStore, Institution } from '../store/authStore';

export default function SelectInstitutionScreen() {
  const router = useRouter();
  const { setInstitution } = useAuthStore();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/institutions')
      .then(r => setInstitutions(r.data.institutions || []))
      .catch(() => setError('Could not load institutions. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelect(inst: Institution) {
    await setInstitution(inst);
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>CanteenRush</Text>
        <Text style={styles.subtitle}>Select your institution</Text>
      </View>

      {loading && <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />}
      {!!error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={institutions}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => handleSelect(item)} activeOpacity={0.7}>
            <View style={styles.cardInner}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
              </View>
              <View style={styles.cardText}>
                <Text style={styles.instName}>{item.name}</Text>
                <Text style={styles.instMeta}>{item.city} · @{item.emailDomain}</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No institutions found.</Text> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { alignItems: 'center', paddingTop: 48, paddingBottom: 32, paddingHorizontal: 24 },
  logo: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#ffffff80' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { backgroundColor: '#ffffff10', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  cardInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#e94560', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardText: { flex: 1, marginLeft: 14 },
  instName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  instMeta: { color: '#ffffff60', fontSize: 12, marginTop: 2 },
  arrow: { color: '#ffffff40', fontSize: 24 },
  error: { color: '#ef4444', textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
  empty: { color: '#ffffff50', textAlign: 'center', marginTop: 40 },
});
