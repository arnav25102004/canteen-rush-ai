import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listMyFeedback, MyFeedbackListItem } from '../../services/feedback';
import { CopyKey, t } from '../../components/feedback/copy';
import { useFeedbackLang } from '../../components/feedback/hooks';

const STEPS = ['RECEIVED', 'SEEN', 'IN_PROGRESS', 'RESOLVED'] as const;

/** Index of the furthest tracker step reached; closed states count as the final step. */
function stepIndex(status: string): number {
  const i = STEPS.indexOf(status as (typeof STEPS)[number]);
  return i >= 0 ? i : STEPS.length - 1;
}

function Tracker({ status, lang }: { status: string; lang: 'en' | 'hi' }) {
  const idx = stepIndex(status);
  const closed = status === 'WONT_FIX' || status === 'DUPLICATE';
  return (
    <View style={s.tracker} accessibilityLabel={t(`st${status}` as CopyKey, lang)}>
      {STEPS.map((st, i) => {
        const label = closed && i === STEPS.length - 1 ? t(`st${status}` as CopyKey, lang) : t(`st${st}` as CopyKey, lang);
        return (
          <View key={st} style={s.step}>
            <View style={[s.dot, i <= idx && s.dotOn]} />
            <Text style={[s.stepText, i <= idx && s.stepTextOn]} numberOfLines={1}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function MyFeedbackScreen() {
  const router = useRouter();
  const [lang] = useFeedbackLang();
  const [rows, setRows] = useState<MyFeedbackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setRows((await listMyFeedback()).feedback);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('close', lang)}>
          <Text style={s.link}>{t('back', lang)}</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('mineTitle', lang)}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#e94560" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyTitle}>{error ? t('mineLoadError', lang) : t('mineEmptyTitle', lang)}</Text>
              {!error && <Text style={s.emptyBody}>{t('mineEmptyBody', lang)}</Text>}
              {error && (
                <TouchableOpacity onPress={onRefresh} accessibilityRole="button">
                  <Text style={s.link}>{t('tryAgain', lang)}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const replies = item.timeline.filter((e) => e.type === 'reply' && e.reply);
            const kindKey = `kindLabel${item.kind}` as CopyKey;
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <Text style={s.kind}>{t(kindKey, lang)}</Text>
                  <Text style={s.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                </View>
                {item.overallRating ? <Text style={s.rating}>{'★'.repeat(item.overallRating)}</Text> : null}
                {item.body ? <Text style={s.body} numberOfLines={4}>{item.body}</Text> : null}
                <Tracker status={item.status} lang={lang} />
                {replies.map((r, i) => (
                  <View key={i} style={s.reply}>
                    <Text style={s.replyLabel}>{t('teamReply', lang)}</Text>
                    <Text style={s.replyText}>{r.reply}</Text>
                  </View>
                ))}
              </View>
            );
          }}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 6 },
  emptyBody: { fontSize: 13, color: '#888', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  kind: { fontSize: 13, fontWeight: '700', color: '#1a1a2e' },
  date: { fontSize: 12, color: '#999' },
  rating: { color: '#f59e0b', marginTop: 4 },
  body: { fontSize: 14, color: '#444', marginTop: 6 },
  tracker: { flexDirection: 'row', marginTop: 12 },
  step: { flex: 1, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e5e7eb' },
  dotOn: { backgroundColor: '#16a34a' },
  stepText: { fontSize: 10, color: '#aaa', marginTop: 4, textAlign: 'center' },
  stepTextOn: { color: '#333', fontWeight: '600' },
  reply: { backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10, marginTop: 10 },
  replyLabel: { fontSize: 11, fontWeight: '700', color: '#15803d' },
  replyText: { fontSize: 13, color: '#333', marginTop: 2 },
});
