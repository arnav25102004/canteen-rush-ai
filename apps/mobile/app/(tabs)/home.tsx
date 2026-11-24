import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, AppState } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../../services/api';
import { getCapabilities } from '../../services/assistant';
import { useCartStore } from '../../store/cartStore';
import { useAuthStore } from '../../store/authStore';
import { getChangelog, ChangelogEntry } from '../../services/feedback';
import { t } from '../../components/feedback/copy';

interface Canteen {
  id: string; name: string; campus: string; location: string;
  imageUrl?: string; isActive: boolean; openingTime: string; closingTime: string;
  avgPrepTime: number; _count: { orders: number };
  /** 7-day average rating; null until the canteen has 10+ ratings. */
  mood?: number | null; moodCount?: number;
}

const DISMISS_KEY = (id: string) => `changelog_dismissed_${id}`;

interface LastOrder {
  id: string;
  canteen: { id: string; name: string; isActive: boolean };
  items: Array<{ menuItemId: string; quantity: number; menuItem: { id: string; name: string; price: string; isAvailable: boolean; isVeg?: boolean } }>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { institution, switchInstitution } = useAuthStore();
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [filtered, setFiltered] = useState<Canteen[]>([]);
  const [search, setSearch] = useState('');
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [topRated, setTopRated] = useState(false);
  const [changelog, setChangelog] = useState<ChangelogEntry | null>(null);
  const [assistantOn, setAssistantOn] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function fetchCanteens() {
    const canteenUrl = institution
      ? `/institutions/${institution.id}/canteens`
      : '/canteens';
    return api.get(canteenUrl).then(r => {
      const list = r.data.canteens || [];
      setCanteens(list);
    }).catch(() => null); // keep the last list; the next poll retries
  }

  useEffect(() => {
    Promise.all([
      fetchCanteens().finally(() => setLoading(false)),
      api.get('/orders/last-order').then(r => setLastOrder(r.data.order)).catch(() => null),
    ]);

    // Latest changelog entry, unless it was dismissed (stored per entry id).
    getChangelog(1, 1).then(async ({ entries }) => {
      const latest = entries[0];
      if (!latest) return;
      let dismissed: string | null = null;
      try { dismissed = await AsyncStorage.getItem(DISMISS_KEY(latest.id)); } catch { /* show it */ }
      if (!dismissed) setChangelog(latest);
    }).catch(() => null);

    // Jittered so a whole campus does not refresh in the same second; paused in the background.
    pollRef.current = setInterval(() => {
      if (AppState.currentState === 'active') fetchCanteens();
    }, 30000 + Math.floor(Math.random() * 5000));

    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') fetchCanteens();
    });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      appStateSub.remove();
    };
  }, [institution?.id]);

  useEffect(() => {
    let list = search ? canteens.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : canteens;
    // Top rated: only canteens with enough ratings to have a mood, best first.
    if (topRated) list = list.filter(c => c.mood != null).sort((a, b) => (b.mood ?? 0) - (a.mood ?? 0));
    setFiltered(list);
  }, [search, canteens, topRated]);

  async function dismissChangelog() {
    if (!changelog) return;
    const id = changelog.id;
    setChangelog(null);
    try { await AsyncStorage.setItem(DISMISS_KEY(id), '1'); } catch { /* shows again next time */ }
  }

  // The button shows only when the server says the assistant is enabled (hidden on 404 or any error).
  useFocusEffect(useCallback(() => {
    let live = true;
    getCapabilities().then(c => { if (live) setAssistantOn(!!c.enabled); }).catch(() => { if (live) setAssistantOn(false); });
    return () => { live = false; };
  }, []));

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
    useCartStore.getState().replaceCart(
      lastOrder.canteen.id,
      lastOrder.canteen.name,
      lastOrder.items.map(i => ({
        menuItemId: i.menuItem.id,
        name: i.menuItem.name,
        price: Number(i.menuItem.price),
        isVeg: i.menuItem.isVeg ?? true,
        quantity: i.quantity,
      })),
    );
    router.push('/checkout');
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;

  return (
    <View style={styles.container}>
      {institution && (
        <View style={styles.instBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.instName}>{institution.name}</Text>
            {institution.city ? <Text style={styles.instCity}>{institution.city}</Text> : null}
          </View>
          <TouchableOpacity onPress={switchInstitution} style={styles.switchBtn}>
            <Text style={styles.switchText}>Switch</Text>
          </TouchableOpacity>
        </View>
      )}
      <TextInput style={styles.search} placeholder="Search canteens..." value={search}
        onChangeText={setSearch} placeholderTextColor="#999" />
      <View style={styles.chipRow}>
        <TouchableOpacity
          onPress={() => setTopRated(v => !v)}
          style={[styles.chip, topRated && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: topRated }}
          accessibilityLabel={t('topRated')}>
          <Text style={[styles.chipText, topRated && styles.chipTextOn]}>⭐ {t('topRated')}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={<>
          {changelog && (
            <View style={styles.changelogCard} accessible accessibilityLabel={`${t('changelogTitle')}. ${changelog.title}. ${changelog.body}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.changelogKicker}>{t('changelogTitle')}</Text>
                <Text style={styles.changelogTitle}>{changelog.title}</Text>
                <Text style={styles.changelogBody} numberOfLines={3}>{changelog.body}</Text>
                <TouchableOpacity onPress={() => router.push('/feedback/changelog')} accessibilityRole="button">
                  <Text style={styles.changelogMore}>See all →</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={dismissChangelog} accessibilityRole="button" accessibilityLabel={t('changelogDismiss')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.changelogX}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {lastOrder ? (
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
        </>}
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
            {c.mood != null && (
              <View style={styles.moodPill} accessible accessibilityLabel={t('moodLabel', 'en', { mood: c.mood.toFixed(1), n: c.moodCount ?? 0 })}>
                <Text style={styles.moodText}>{c.mood.toFixed(1)} 😋 ({c.moodCount ?? 0})</Text>
              </View>
            )}
            {c._count.orders > 0 && (
              <Text style={styles.queueText}>👥 {c._count.orders} active orders</Text>
            )}
          </TouchableOpacity>
        )}
      />
      {assistantOn && (
        <TouchableOpacity style={styles.fab} onPress={() => router.push('/assistant')} accessibilityRole="button" accessibilityLabel="Order with assistant">
          <Text style={styles.fabText}>Order with assistant</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 16, bottom: 20, backgroundColor: '#e94560', borderRadius: 28, paddingHorizontal: 18, paddingVertical: 14, elevation: 6 },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  instBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e', paddingHorizontal: 16, paddingVertical: 12 },
  instName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  instCity: { color: '#ffffff60', fontSize: 11, marginTop: 1 },
  switchBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#ffffff30' },
  switchText: { color: '#ffffff80', fontSize: 12 },
  search: { margin: 16, backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  canteenName: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  canteenMeta: { fontSize: 12, color: '#666', marginBottom: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  moodPill: { alignSelf: 'flex-start', backgroundColor: '#fef3c7', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8 },
  moodText: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  chipRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: -6, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  chipTextOn: { color: '#fff' },
  changelogCard: { flexDirection: 'row', backgroundColor: '#ecfdf5', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#a7f3d0' },
  changelogKicker: { fontSize: 11, fontWeight: '700', color: '#047857', textTransform: 'uppercase', letterSpacing: 0.5 },
  changelogTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginTop: 2 },
  changelogBody: { fontSize: 13, color: '#374151', marginTop: 2 },
  changelogMore: { fontSize: 12, fontWeight: '700', color: '#047857', marginTop: 6 },
  changelogX: { fontSize: 16, color: '#6b7280' },
  queueText: { fontSize: 12, color: '#f59e0b', marginTop: 8 },
  reorderCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 16, marginBottom: 16 },
  reorderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reorderTitle: { fontSize: 12, fontWeight: '700', color: '#ffffff80', textTransform: 'uppercase', letterSpacing: 0.5 },
  reorderCanteen: { fontSize: 12, color: '#e94560', fontWeight: '600' },
  reorderItems: { fontSize: 14, color: '#ffffffcc', marginBottom: 12 },
  reorderBtn: { backgroundColor: '#e94560', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  reorderBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
