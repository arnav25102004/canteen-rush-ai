import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { ChangelogEntry, getChangelog } from '../../services/feedback';
import { t } from '../../components/feedback/copy';

export default function ChangelogScreen() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const r = await getChangelog(1, 50);
      setEntries(r.entries);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t('changelogLoadError')}</Text>
        <TouchableOpacity onPress={load} style={styles.btn} accessibilityRole="button">
          <Text style={styles.btnText}>{t('tryAgain')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={entries}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 16 }}
      ListHeaderComponent={<Text style={styles.heading} accessibilityRole="header">{t('changelogTitle')}</Text>}
      ListEmptyComponent={<Text style={styles.muted}>{t('changelogEmpty')}</Text>}
      renderItem={({ item }) => (
        <View style={styles.card} accessible accessibilityLabel={`${item.title}. ${item.body}`}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.body}>{item.body}</Text>
          <Text style={styles.date}>{new Date(item.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: '#f8f9fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#1a1a2e', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: '#10b981' },
  title: { fontSize: 15, fontWeight: '700', color: '#1a1a2e' },
  body: { fontSize: 14, color: '#374151', marginTop: 4 },
  date: { fontSize: 11, color: '#9ca3af', marginTop: 8 },
  muted: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 20 },
  btn: { marginTop: 12, backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  btnText: { color: '#fff', fontWeight: '700' },
});
