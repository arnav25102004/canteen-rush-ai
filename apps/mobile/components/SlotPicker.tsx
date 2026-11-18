import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import api from '../services/api';
import type { CartSlot } from '../store/cartStore';

interface SlotRow {
  slotId: string;
  startTime: string;
  endTime: string;
  date: string;
  available: number;
  isFull: boolean;
  isOpen: boolean;
  isCutoffPassed: boolean;
}

interface Props {
  canteenId: string;
  value: CartSlot | null;
  onChange: (slot: CartSlot | null) => void;
  /** Bump to force a refetch (e.g. after the server rejected the chosen slot). */
  refreshKey?: number;
}

const REFRESH_MS = 60_000;

export default function SlotPicker({ canteenId, value, onChange, refreshKey = 0 }: Props) {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/canteens/${canteenId}/slots`);
      const rows: SlotRow[] = data.slots || [];
      setSlots(rows);
      setFailed(false);
      // Drop a selection that is no longer bookable.
      const current = valueRef.current;
      if (current) {
        const row = rows.find((r) => r.slotId === current.id);
        if (!row || !row.isOpen || row.isFull || row.isCutoffPassed) onChange(null);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [canteenId, onChange]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Pickup time</Text>
      {loading ? (
        <ActivityIndicator color="#e94560" />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Chip label="As soon as possible" selected={!value} onPress={() => onChange(null)} />
          {slots.map((s) => {
            const disabled = !s.isOpen || s.isFull || s.isCutoffPassed;
            const selected = value?.id === s.slotId;
            const note = s.isFull ? 'Full' : s.isCutoffPassed ? 'Closed' : !s.isOpen ? 'Closed' : `${s.available} left`;
            return (
              <Chip
                key={s.slotId}
                label={`${s.startTime}`}
                note={note}
                selected={selected}
                disabled={disabled}
                onPress={() => onChange({ id: s.slotId, startTime: s.startTime, endTime: s.endTime, date: s.date })}
              />
            );
          })}
        </ScrollView>
      )}
      {failed && <Text style={styles.warn}>Couldn't load pickup times. You can still order without one.</Text>}
      {!loading && !failed && slots.length === 0 && <Text style={styles.hint}>No pickup times today. Your order will be ready as soon as possible.</Text>}
    </View>
  );
}

function Chip({ label, note, selected, disabled, onPress }: { label: string; note?: string; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={note ? `${label}, ${note}` : label}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
      {note ? <Text style={[styles.chipNote, selected && styles.chipLabelSelected]}>{note}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4 },
  title: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  row: { gap: 8 },
  chip: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', minWidth: 72 },
  chipSelected: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipDisabled: { opacity: 0.4 },
  chipLabel: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  chipLabelSelected: { color: '#fff' },
  chipNote: { fontSize: 11, color: '#888', marginTop: 2 },
  warn: { marginTop: 8, fontSize: 12, color: '#b45309' },
  hint: { marginTop: 8, fontSize: 12, color: '#888' },
});
