import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getEligibility, withinReviewWindow } from '../../services/feedback';
import { t, Lang } from './copy';
import { useFeedbackLang, useQueueState } from './hooks';

/** Chip for the orders list. `reviewed` comes from GET /feedback/mine. */
export function ReviewChip({ orderId, orderNumber, pickedUpAt, reviewed }: {
  orderId: string; orderNumber: string; pickedUpAt?: string | null; reviewed: boolean;
}) {
  const router = useRouter();
  const [lang] = useFeedbackLang();
  const queue = useQueueState(orderId);
  if (queue) {
    return (
      <View style={[styles.chip, styles.chipInfo]} accessibilityRole="text">
        <Text style={styles.chipInfoText}>{queue === 'sending' ? t('chipSending', lang) : t('chipQueued', lang)}</Text>
      </View>
    );
  }
  if (reviewed) {
    return (
      <View style={[styles.chip, styles.chipDone]} accessibilityRole="text" accessibilityLabel={t('chipRatedLabel', lang, { n: orderNumber })}>
        <Text style={styles.chipDoneText}>✓ {t('chipRated', lang)}</Text>
      </View>
    );
  }
  if (!withinReviewWindow(pickedUpAt)) return null;
  return (
    <TouchableOpacity
      onPress={() => router.push(`/feedback/order/${orderId}`)}
      accessibilityRole="button"
      accessibilityLabel={t('chipRateLabel', lang, { n: orderNumber })}
      style={[styles.chip, styles.chipRate]}>
      <Text style={styles.chipRateText}>★ {t('chipRate', lang)}</Text>
    </TouchableOpacity>
  );
}

/** Card on the order screen: only when the order is picked up, unreviewed and inside the 7 days. */
export function ReviewEntryCard({ orderId, status, pickedUpAt }: { orderId: string; status: string; pickedUpAt?: string | null }) {
  const router = useRouter();
  const [lang] = useFeedbackLang();
  const queue = useQueueState(orderId);
  const [eligible, setEligible] = useState(false);
  const relevant = status === 'PICKED_UP' && withinReviewWindow(pickedUpAt);

  useFocusEffect(
    useCallback(() => {
      if (!relevant) return;
      let alive = true;
      getEligibility(orderId).then((e) => { if (alive) setEligible(e.eligible); }).catch(() => {});
      return () => { alive = false; };
    }, [orderId, relevant]),
  );

  if (queue) {
    return (
      <View style={styles.card} accessibilityRole="text">
        <Text style={styles.cardBody}>{queue === 'sending' ? t('sending', lang) : t('queued', lang)}</Text>
      </View>
    );
  }
  if (!relevant || !eligible) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">{t('entryTitle', lang)}</Text>
      <Text style={styles.cardBody}>{t('entryBody', lang)}</Text>
      <TouchableOpacity onPress={() => router.push(`/feedback/order/${orderId}`)} accessibilityRole="button"
        accessibilityLabel={t('entryCta', lang)} style={styles.cta}>
        <Text style={styles.ctaText}>{t('entryCta', lang)}</Text>
      </TouchableOpacity>
    </View>
  );
}

export type { Lang };

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, minHeight: 28, justifyContent: 'center' },
  chipRate: { backgroundColor: '#fff1f3', borderWidth: 1, borderColor: '#e94560' },
  chipRateText: { color: '#e94560', fontWeight: '700', fontSize: 12 },
  chipDone: { backgroundColor: '#dcfce7' },
  chipDoneText: { color: '#15803d', fontWeight: '600', fontSize: 12 },
  chipInfo: { backgroundColor: '#eff6ff' },
  chipInfoText: { color: '#1d4ed8', fontWeight: '600', fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#fbcfe8' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  cardBody: { fontSize: 13, color: '#4b5563', marginTop: 4 },
  cta: { marginTop: 12, backgroundColor: '#e94560', borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10 },
  ctaText: { color: '#fff', fontWeight: '700' },
});
