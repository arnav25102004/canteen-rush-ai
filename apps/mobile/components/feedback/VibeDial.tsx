import type React from 'react';
import { useRef } from 'react';
import { View, Text, TouchableOpacity, PanResponder, StyleSheet, LayoutChangeEvent } from 'react-native';
import { t, Lang, VIBE_FACES, VIBE_KEYS } from './copy';
import { tick } from './haptics';

interface Props { value: number | null; onChange: (n: number) => void; lang: Lang }

/** Five faces. Tap one, or slide a finger across them; each new face gives a haptic tick. */
export default function VibeDial({ value, onChange, lang }: Props) {
  const last = useRef<number | null>(value);
  const widthRef = useRef(0);
  const startX = useRef(0);
  const rowRef = useRef<React.ComponentRef<typeof View>>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pick = (n: number) => {
    if (last.current !== n) { last.current = n; tick(); }
    onChangeRef.current(n);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // taps go to the face buttons
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6,
      onPanResponderGrant: () => {
        rowRef.current?.measureInWindow((x: number) => { startX.current = x; });
      },
      onPanResponderMove: (e) => {
        const w = widthRef.current;
        if (!w) return;
        const n = Math.min(5, Math.max(1, Math.floor(((e.nativeEvent.pageX - startX.current) / w) * 5) + 1));
        pick(n);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => { widthRef.current = e.nativeEvent.layout.width; };

  return (
    <View ref={rowRef} {...pan.panHandlers} onLayout={onLayout} style={styles.row} accessibilityRole="radiogroup">
      {VIBE_FACES.map((face, i) => {
        const n = i + 1;
        const selected = value === n;
        const name = t(VIBE_KEYS[i], lang);
        return (
          <TouchableOpacity
            key={n}
            onPress={() => pick(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t('vibeLabel', lang, { n, name })}
            style={[styles.face, selected && styles.faceSel, value != null && !selected && styles.faceDim]}>
            <Text style={[styles.emoji, selected && styles.emojiSel]}>{face}</Text>
            <Text style={[styles.name, selected && styles.nameSel]}>{name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  face: { alignItems: 'center', justifyContent: 'center', minWidth: 60, minHeight: 72, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: '#e5e7eb' },
  faceSel: { borderColor: '#e94560', backgroundColor: '#fff1f3' },
  faceDim: { opacity: 0.6 },
  emoji: { fontSize: 34 },
  emojiSel: { fontSize: 38 },
  name: { fontSize: 11, color: '#6b7280', marginTop: 2, textAlign: 'center' },
  nameSel: { color: '#e94560', fontWeight: '700' },
});
