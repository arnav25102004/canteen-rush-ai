import { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Idea, listIdeas, voteIdea, unvoteIdea } from '../../services/feedback';
import { t } from '../../components/feedback/copy';
import { useFeedbackLang } from '../../components/feedback/hooks';

export default function IdeasScreen() {
  const router = useRouter();
  const [lang] = useFeedbackLang();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (more = false) => {
    try {
      const r = await listIdeas(more ? cursor ?? undefined : undefined);
      setIdeas((prev) => (more ? [...prev, ...r.ideas] : r.ideas));
      setCursor(r.nextCursor);
      setError(null);
    } catch {
      setError(t('ideasLoadError', lang));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [cursor, lang]);

  useFocusEffect(useCallback(() => { void load(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  async function toggle(idea: Idea) {
    const next = !idea.voted;
    const apply = (voted: boolean, voteCount: number) =>
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, voted, voteCount } : i)));
    apply(next, idea.voteCount + (next ? 1 : -1)); // optimistic
    try {
      const r = next ? await voteIdea(idea.id) : await unvoteIdea(idea.id);
      apply(r.voted, r.voteCount);
      setError(null);
    } catch {
      apply(idea.voted, idea.voteCount); // roll back
      setError(t('ideasVoteError', lang));
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('close', lang)}>
          <Text style={s.link}>{t('close', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('ideasTitle', lang)}</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={s.sub}>{t('ideasSub', lang)}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator style={{ marginTop: 24 }} color="#e94560" /> : (
        <FlatList
          data={ideas}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(false); }} />}
          onEndReached={() => { if (cursor) void load(true); }}
          ListEmptyComponent={<Text style={s.empty}>{t('ideasEmpty', lang)}</Text>}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.text}>{item.text}</Text>
                <Text style={s.meta}>{item.status.replace('_', ' ').toLowerCase()}{item.mine ? ` · ${t('ideaYours', lang)}` : ''}</Text>
              </View>
              <TouchableOpacity
                style={[s.vote, item.voted && s.voteOn, item.mine && { opacity: 0.4 }]}
                disabled={item.mine}
                onPress={() => toggle(item)}
                accessibilityRole="button"
                accessibilityState={{ selected: item.voted, disabled: item.mine }}
                accessibilityLabel={`+1, ${item.voteCount}`}
              >
                <Text style={[s.voteText, item.voted && s.voteTextOn]}>▲</Text>
                <Text style={[s.voteText, item.voted && s.voteTextOn]}>{item.voteCount}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  link: { color: '#e94560', fontWeight: '600', fontSize: 13 },
  sub: { fontSize: 12, color: '#888', paddingHorizontal: 16 },
  error: { color: '#dc2626', fontSize: 13, paddingHorizontal: 16, marginTop: 8 },
  empty: { textAlign: 'center', color: '#888', marginTop: 40 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  text: { fontSize: 15, color: '#1a1a2e' },
  meta: { fontSize: 11, color: '#999', marginTop: 4 },
  vote: { alignItems: 'center', minWidth: 48, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#ddd' },
  voteOn: { borderColor: '#e94560', backgroundColor: '#fff1f3' },
  voteText: { fontSize: 13, color: '#555', fontWeight: '700' },
  voteTextOn: { color: '#e94560' },
});
