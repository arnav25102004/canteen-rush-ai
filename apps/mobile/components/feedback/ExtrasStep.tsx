import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { t, Lang, CANTEEN_TAG_CHOICES, NOTE_MAX } from './copy';

interface Props {
  tags: string[];
  onTags: (t: string[]) => void;
  body: string;
  onBody: (s: string) => void;
  anonymous: boolean;
  onAnonymous: (b: boolean) => void;
  showAnonymous: boolean;
  lang: Lang;
}

export default function ExtrasStep({ tags, onTags, body, onBody, anonymous, onAnonymous, showAnonymous, lang }: Props) {
  const toggle = (tag: string) => onTags(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]);
  return (
    <View>
      <Text style={styles.h}>{t('canteenTags', lang)}</Text>
      <View style={styles.wrap}>
        {CANTEEN_TAG_CHOICES.map((c) => {
          const on = tags.includes(c.tag);
          return (
            <TouchableOpacity key={c.tag} onPress={() => toggle(c.tag)} accessibilityRole="button"
              accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(c.label, lang)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        value={body}
        onChangeText={(s) => onBody(s.slice(0, NOTE_MAX))}
        maxLength={NOTE_MAX}
        multiline
        placeholder={t('notePlaceholder', lang)}
        accessibilityLabel={t('notePlaceholder', lang)}
        style={styles.input}
        textAlignVertical="top"
      />
      <Text style={styles.counter} accessibilityLabel={t('noteCounter', lang, { n: body.length })}>
        {t('noteCounter', lang, { n: body.length })}
      </Text>
      <Text style={styles.hint}>{t('piiHint', lang)}</Text>

      {showAnonymous && (
        <View style={styles.anon}>
          <View style={styles.anonRow}>
            <Text style={styles.anonLabel}>{t('anonymous', lang)}</Text>
            <Switch value={anonymous} onValueChange={onAnonymous} accessibilityLabel={t('anonymous', lang)} />
          </View>
          <Text style={styles.explain}>{t('anonymousExplain', lang)}</Text>
          <Text style={styles.hint}>{t('anonymousAdminNote', lang)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', justifyContent: 'center' },
  chipOn: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#374151', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  input: { minHeight: 100, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, fontSize: 15 },
  counter: { alignSelf: 'flex-end', fontSize: 12, color: '#6b7280', marginTop: 4 },
  hint: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  anon: { marginTop: 16, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  anonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  anonLabel: { flex: 1, fontWeight: '700', color: '#1a1a2e' },
  explain: { marginTop: 4, color: '#374151' },
});
