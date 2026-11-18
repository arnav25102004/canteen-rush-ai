import { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, PanResponder, StyleSheet } from 'react-native';
import { t, Lang } from './copy';
import { tick } from './haptics';
import { useReduceMotion } from './useReduceMotion';

export interface ItemAnswer { rating: number; taste?: number; portion?: number; value?: number }
export interface StackItem { menuItemId: string; name: string }

interface Props {
  items: StackItem[];
  answers: Record<string, ItemAnswer>;
  skipped: string[];
  onAnswer: (menuItemId: string, a: ItemAnswer) => void;
  onSkip: (menuItemId: string) => void;
  onUndo: () => void;
  lang: Lang;
}

const SWIPE = 90;

/** One card per item. Swipe right = loved, left = not great, up = skip, or use the buttons. */
export default function ItemCardStack({ items, answers, skipped, onAnswer, onSkip, onUndo, lang }: Props) {
  const reduceMotion = useReduceMotion();
  const remaining = items.filter((i) => !answers[i.menuItemId] && !skipped.includes(i.menuItemId));
  const current = remaining[0];
  const doneCount = items.length - remaining.length;
  const [starsFor, setStarsFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemAnswer | null>(null);
  const pos = useRef(new Animated.ValueXY()).current;

  const commit = (kind: 'love' | 'meh' | 'skip') => {
    if (!current) return;
    tick();
    pos.setValue({ x: 0, y: 0 });
    if (kind === 'love') onAnswer(current.menuItemId, { rating: 5 });
    else if (kind === 'meh') onAnswer(current.menuItemId, { rating: 2 });
    else onSkip(current.menuItemId);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;

  const pan = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      // With reduced motion the card stays put and only the final direction counts.
      onPanResponderMove: (_e, g) => { if (!reduceRef.current) pos.setValue({ x: g.dx, y: Math.min(0, g.dy) }); },
      onPanResponderRelease: (_e, g) => {
        const act = g.dx > SWIPE ? 'love' : g.dx < -SWIPE ? 'meh' : g.dy < -SWIPE ? 'skip' : null;
        if (!act) {
          if (reduceRef.current) pos.setValue({ x: 0, y: 0 });
          else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          return;
        }
        commitRef.current(act);
      },
      onPanResponderTerminate: () => pos.setValue({ x: 0, y: 0 }),
    }),
    [pos],
  );

  if (!current) {
    return (
      <View>
        <Text style={styles.done}>{t('itemDone', lang)} ✓</Text>
        {doneCount > 0 && (
          <TouchableOpacity onPress={onUndo} accessibilityRole="button" accessibilityLabel={t('undo', lang)} style={styles.linkBtn}>
            <Text style={styles.link}>{t('undo', lang)}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const open = starsFor === current.menuItemId;
  const d = draft ?? { rating: 0 };
  const rotate = pos.x.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-8deg', '0deg', '8deg'] });

  const setStar = (n: number) => { tick(); setDraft({ ...d, rating: n }); };
  const setMeter = (k: 'taste' | 'portion' | 'value', n: number) => { tick(); setDraft({ ...d, [k]: n }); };
  const saveStars = () => {
    if (d.rating < 1) return;
    onAnswer(current.menuItemId, d);
    setStarsFor(null); setDraft(null);
  };

  return (
    <View>
      <Text style={styles.progress} accessibilityLiveRegion="polite">
        {t('itemProgress', lang, { i: doneCount + 1, n: items.length })}
      </Text>

      <Animated.View
        {...(open ? {} : pan.panHandlers)}
        style={[styles.card, !reduceMotion && { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate }] }]}>
        <TouchableOpacity
          onPress={() => { setStarsFor(current.menuItemId); setDraft(null); }}
          accessibilityRole="button"
          accessibilityLabel={`${current.name}. ${t('tapForStars', lang)}`}
          activeOpacity={0.8}>
          <Text style={styles.itemName}>{current.name}</Text>
          <Text style={styles.cardHint}>{t('tapForStars', lang)}</Text>
        </TouchableOpacity>
      </Animated.View>

      {open ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t('stars', lang)}</Text>
          <View style={styles.rowWrap}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setStar(n)} accessibilityRole="button"
                accessibilityState={{ selected: d.rating >= n }} accessibilityLabel={t('starLabel', lang, { n })} style={styles.star}>
                <Text style={[styles.starText, d.rating >= n && styles.starOn]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          {d.rating > 0 && (['taste', 'portion', 'value'] as const).map((k) => (
            <View key={k} style={styles.meter}>
              <Text style={styles.meterName}>{t(k, lang)}</Text>
              <View style={styles.rowWrap}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity key={n} onPress={() => setMeter(k, n)} accessibilityRole="button"
                    accessibilityState={{ selected: (d[k] ?? 0) >= n }}
                    accessibilityLabel={t('meterLabel', lang, { name: t(k, lang), n })}
                    style={[styles.pip, (d[k] ?? 0) >= n && styles.pipOn]}>
                    <Text style={[styles.pipText, (d[k] ?? 0) >= n && styles.pipTextOn]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={saveStars} disabled={d.rating < 1} accessibilityRole="button"
            accessibilityState={{ disabled: d.rating < 1 }} style={[styles.primary, d.rating < 1 && { opacity: 0.4 }]}>
            <Text style={styles.primaryText}>{t('next', lang)}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity onPress={() => commit('meh')} accessibilityRole="button" accessibilityLabel={t('notGreat', lang)} style={[styles.act, styles.actMeh]}>
            <Text style={styles.actText}>👎 {t('notGreat', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => commit('skip')} accessibilityRole="button" accessibilityLabel={t('skip', lang)} style={[styles.act, styles.actSkip]}>
            <Text style={styles.actText}>⏭ {t('skip', lang)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => commit('love')} accessibilityRole="button" accessibilityLabel={t('loved', lang)} style={[styles.act, styles.actLove]}>
            <Text style={styles.actText}>😍 {t('loved', lang)}</Text>
          </TouchableOpacity>
        </View>
      )}

      {doneCount > 0 && (
        <TouchableOpacity onPress={onUndo} accessibilityRole="button" accessibilityLabel={t('undo', lang)} style={styles.linkBtn}>
          <Text style={styles.link}>{t('undo', lang)}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { textAlign: 'center', color: '#6b7280', marginBottom: 8, fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 24, minHeight: 140, justifyContent: 'center', borderWidth: 1, borderColor: '#e5e7eb', elevation: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8 },
  itemName: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', textAlign: 'center' },
  cardHint: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, justifyContent: 'center' },
  act: { flexGrow: 1, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actMeh: { backgroundColor: '#fee2e2' },
  actSkip: { backgroundColor: '#f3f4f6' },
  actLove: { backgroundColor: '#dcfce7' },
  actText: { fontWeight: '700', color: '#1a1a2e', textAlign: 'center' },
  panel: { marginTop: 16, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  panelTitle: { fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  star: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 32, color: '#d1d5db' },
  starOn: { color: '#f59e0b' },
  meter: { marginTop: 12 },
  meterName: { fontSize: 13, color: '#374151', marginBottom: 4 },
  pip: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' },
  pipOn: { backgroundColor: '#e94560' },
  pipText: { color: '#374151', fontWeight: '600' },
  pipTextOn: { color: '#fff' },
  primary: { marginTop: 16, backgroundColor: '#e94560', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  done: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#10b981', marginVertical: 24 },
  linkBtn: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginTop: 8 },
  link: { color: '#e94560', fontWeight: '600' },
});
