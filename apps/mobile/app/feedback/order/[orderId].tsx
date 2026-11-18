import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eligibility, getEligibility, getMyFeedback, getFeedbackStreak, FeedbackStreak, newRequestId, CreateReviewPayload } from '../../../services/feedback';
import {
  clearDraft, loadDraft, saveDraft, submitReview, subscribeQueueEvents, ReviewDraft,
} from '../../../services/feedbackQueue';
import { t, VIBE_FACES } from '../../../components/feedback/copy';
import { useFeedbackLang, useQueueState } from '../../../components/feedback/hooks';
import { useReduceMotion } from '../../../components/feedback/useReduceMotion';
import { success } from '../../../components/feedback/haptics';
import VibeDial from '../../../components/feedback/VibeDial';
import ItemCardStack, { ItemAnswer } from '../../../components/feedback/ItemCardStack';
import ExtrasStep from '../../../components/feedback/ExtrasStep';

type Result = null | { state: 'sent'; points: number } | { state: 'queued' } | { state: 'failed'; message: string };

export default function OrderReviewScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const [lang, toggleLang] = useFeedbackLang();
  const reduceMotion = useReduceMotion();
  const queue = useQueueState(orderId);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const [step, setStep] = useState(1);
  const [vibe, setVibe] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>({});
  const [order, setOrder] = useState<string[]>([]); // order in which items were answered, for undo
  const [skipped, setSkipped] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [streak, setStreak] = useState<FeedbackStreak | null>(null);
  const requestId = useRef(newRequestId());

  const effectiveAnonymous = anonymous ?? (vibe != null && vibe <= 2);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (elig?.items ?? []).filter((i) => !seen.has(i.menuItemId) && seen.add(i.menuItemId))
      .map((i) => ({ menuItemId: i.menuItemId, name: i.name || 'Item' }));
  }, [elig]);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const e = await getEligibility(orderId);
      setElig(e);
      const canEdit = !e.eligible && e.existingFeedbackId && e.editDeadline && new Date(e.editDeadline).getTime() > Date.now();
      if (canEdit) {
        const fb = await getMyFeedback(e.existingFeedbackId!);
        setEditId(fb.id);
        setVibe(fb.overallRating);
        setTags(fb.tags ?? []);
        setBody(fb.body ?? '');
        const a: Record<string, ItemAnswer> = {};
        for (const it of fb.items ?? []) a[it.menuItemId] = { rating: it.rating, taste: it.taste, portion: it.portion, value: it.value };
        setAnswers(a);
      } else if (e.eligible) {
        const d = await loadDraft(orderId);
        if (d) {
          setStep(d.step); setVibe(d.vibe); setAnswers(d.itemRatings); setSkipped(d.skipped);
          setTags(d.tags); setBody(d.body); setAnonymous(d.anonymous); setRestored(true);
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  // A queued submit can finish after this screen was left and re-opened.
  useEffect(() => subscribeQueueEvents((e) => {
    if (e.orderId !== orderId) return;
    if (e.type === 'sent') { void clearDraft(orderId); setResult({ state: 'sent', points: e.feedback?.pointsAwarded ?? 0 }); }
    else setResult({ state: 'failed', message: e.message });
  }), [orderId]);

  // Keep the draft up to date so backgrounding or a crash loses nothing.
  useEffect(() => {
    if (loading || result || editId || !elig?.eligible) return;
    const d: ReviewDraft = { step, vibe, itemRatings: answers, skipped, tags, body, anonymous };
    void saveDraft(orderId, d);
  }, [loading, result, editId, elig, step, vibe, answers, skipped, tags, body, anonymous, orderId]);

  const buildPayload = (quick: boolean): CreateReviewPayload => ({
    orderId,
    clientRequestId: requestId.current,
    overallRating: vibe as number,
    ...(quick ? {} : {
      tags: tags.length ? tags : undefined,
      body: body.trim() || undefined,
      items: Object.entries(answers).map(([menuItemId, a]) => ({ menuItemId, ...a })),
    }),
    isAnonymous: effectiveAnonymous,
  });

  const submit = async (quick: boolean) => {
    if (vibe == null || submitting) return;
    setSubmitting(true);
    const r = await submitReview(orderId, buildPayload(quick), { feedbackId: editId ?? undefined });
    setSubmitting(false);
    if (r.state === 'sent') {
      await clearDraft(orderId);
      if (!reduceMotion) success();
      // Only what the server says: points are shown only if it awarded them.
      setResult({ state: 'sent', points: r.feedback?.pointsAwarded ?? 0 });
      getFeedbackStreak().then(setStreak).catch(() => {});
    }
    else if (r.state === 'queued') { await clearDraft(orderId); setResult({ state: 'queued' }); }
    else setResult({ state: 'failed', message: r.message });
  };

  const answer = (id: string, a: ItemAnswer) => { setAnswers((p) => ({ ...p, [id]: a })); setOrder((o) => [...o.filter((x) => x !== id), id]); };
  const skip = (id: string) => { setSkipped((s) => [...s, id]); setOrder((o) => [...o.filter((x) => x !== id), id]); };
  const undo = () => {
    const last = order[order.length - 1];
    if (!last) return;
    setOrder((o) => o.slice(0, -1));
    setAnswers((p) => { const n = { ...p }; delete n[last]; return n; });
    setSkipped((s) => s.filter((x) => x !== last));
  };

  const close = () => router.back();
  const nextAfterVibe = () => setStep(items.length ? 2 : 3);

  let content: React.ReactNode;
  if (loading) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e94560" />
        <Text style={styles.muted}>{t('loading', lang)}</Text>
      </View>
    );
  } else if (loadError) {
    content = (
      <View style={styles.center}>
        <Text style={styles.body}>{t('errGeneric', lang)}</Text>
        <Btn label={t('tryAgain', lang)} onPress={load} primary />
      </View>
    );
  } else if (result?.state === 'failed') {
    content = (
      <View style={styles.center}>
        <Text style={styles.title} accessibilityRole="header">{t('failedPrefix', lang)}</Text>
        <Text style={styles.body}>{result.message}</Text>
        <Btn label={t('close', lang)} onPress={close} primary />
      </View>
    );
  } else if (result) {
    content = (
      <View style={styles.center}>
        <Text style={styles.bigEmoji} accessibilityElementsHidden importantForAccessibility="no">{vibe ? VIBE_FACES[vibe - 1] : '🙏'}</Text>
        <Text style={styles.title} accessibilityRole="header">{t('thanksTitle', lang)}</Text>
        <Text style={styles.body}>{result.state === 'queued' ? t('thanksQueued', lang) : t('thanksBody', lang)}</Text>
        {vibe != null && vibe <= 2 && <Text style={styles.body}>{t('thanksNegative', lang)}</Text>}
        {result.state === 'sent' && result.points > 0 && (
          <Text style={styles.points} accessibilityLiveRegion="polite">{t('pointsAwarded', lang, { n: result.points })}</Text>
        )}
        {result.state === 'sent' && !!streak && streak.currentStreakWeeks > 0 && (
          <Text style={styles.body}>{t('streakLine', lang, { n: streak.currentStreakWeeks })}</Text>
        )}
        {result.state === 'sent' && <Text style={styles.muted}>{t('pointsNote', lang)}</Text>}
        <Btn label={t('done', lang)} onPress={close} primary />
      </View>
    );
  } else if (!elig?.eligible && !editId) {
    content = (
      <View style={styles.center}>
        <Text style={styles.title} accessibilityRole="header">{t('notEligible', lang)}</Text>
        {!!elig?.reason && <Text style={styles.body}>{elig.reason}</Text>}
        <Btn label={t('close', lang)} onPress={close} primary />
      </View>
    );
  } else {
    content = (
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {editId && <Text style={styles.banner}>{t('editMode', lang)}. {t('editWindow', lang)}</Text>}
        {restored && <Text style={styles.banner}>{t('draftRestored', lang)}</Text>}
        {!!queue && <Text style={styles.chip} accessibilityLiveRegion="polite">{queue === 'sending' ? t('sending', lang) : t('queued', lang)}</Text>}

        {step === 1 && (
          <View>
            <Text style={styles.title} accessibilityRole="header">{t('vibeQuestion', lang)}</Text>
            <Text style={styles.muted}>{t('vibeHint', lang)}</Text>
            <View style={{ marginVertical: 20 }}>
              <VibeDial value={vibe} onChange={setVibe} lang={lang} />
            </View>
            <Btn label={editId ? t('update', lang) : t('quickSubmit', lang)} onPress={() => submit(!editId)} primary disabled={vibe == null || submitting} busy={submitting} />
            <Btn label={t('addMore', lang)} onPress={nextAfterVibe} disabled={vibe == null} />
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.title} accessibilityRole="header">{t('itemsTitle', lang)}</Text>
            <Text style={styles.muted}>{t('itemsHint', lang)}</Text>
            <View style={{ marginVertical: 16 }}>
              <ItemCardStack items={items} answers={answers} skipped={skipped} onAnswer={answer} onSkip={skip} onUndo={undo} lang={lang} />
            </View>
            <Btn label={t('next', lang)} onPress={() => setStep(3)} primary />
            <Btn label={t('back', lang)} onPress={() => setStep(1)} />
          </View>
        )}

        {step === 3 && (
          <View>
            <Text style={styles.title} accessibilityRole="header">{t('extrasTitle', lang)}</Text>
            <View style={{ marginVertical: 16 }}>
              <ExtrasStep tags={tags} onTags={setTags} body={body} onBody={setBody}
                anonymous={effectiveAnonymous} onAnonymous={setAnonymous} showAnonymous={!editId} lang={lang} />
            </View>
            <Btn label={editId ? t('update', lang) : t('submit', lang)} onPress={() => submit(false)} primary disabled={vibe == null || submitting} busy={submitting} />
            <Btn label={t('back', lang)} onPress={() => setStep(items.length ? 2 : 1)} />
          </View>
        )}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t('title', lang)}</Text>
        <TouchableOpacity onPress={toggleLang} accessibilityRole="button" accessibilityLabel={t('langToggle', lang)} style={styles.hBtn}>
          <Text style={styles.hBtnText}>{t('langToggle', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel={t('close', lang)} style={styles.hBtn}>
          <Text style={styles.hBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
      {content}
    </SafeAreaView>
  );
}

function Btn({ label, onPress, primary, disabled, busy }: {
  label: string; onPress: () => void; primary?: boolean; disabled?: boolean; busy?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={[styles.btn, primary ? styles.btnPrimary : styles.btnGhost, disabled && { opacity: 0.4 }]}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, !primary && { color: '#e94560' }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  hBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  hBtnText: { color: '#e94560', fontWeight: '700' },
  scroll: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: '#1a1a2e', textAlign: 'center' },
  body: { fontSize: 15, color: '#374151', textAlign: 'center' },
  points: { fontSize: 20, fontWeight: '800', color: '#10b981', textAlign: 'center', marginTop: 8 },
  muted: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 4 },
  bigEmoji: { fontSize: 64 },
  banner: { backgroundColor: '#fffbeb', color: '#92400e', padding: 10, borderRadius: 10, marginBottom: 12, fontSize: 13 },
  chip: { alignSelf: 'center', backgroundColor: '#eff6ff', color: '#1d4ed8', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, marginTop: 10, alignSelf: 'stretch' },
  btnPrimary: { backgroundColor: '#e94560' },
  btnGhost: { backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15, textAlign: 'center' },
});
