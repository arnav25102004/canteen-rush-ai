import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { t } from './copy';
import { MAX_PHOTOS, photosAvailable, pickPhoto } from '../../services/feedbackPhotos';

/**
 * Optional "Add photo". Hidden once the server has said uploads are unavailable (cached 24h).
 * The photos are uploaded after the feedback is created, so this never blocks a submit.
 */
export default function PhotoAdder({ uris, onChange, lang }: { uris: string[]; onChange: (u: string[]) => void; lang?: any }) {
  const [available, setAvailable] = useState(false);

  useEffect(() => { void photosAvailable().then(setAvailable); }, []);

  if (!available) return null;

  async function add() {
    const uri = await pickPhoto();
    if (uri) onChange([...uris, uri].slice(0, MAX_PHOTOS));
  }

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        {uris.map((u) => (
          <View key={u} style={s.thumbWrap}>
            <Image source={{ uri: u }} style={s.thumb} accessibilityIgnoresInvertColors />
            <TouchableOpacity onPress={() => onChange(uris.filter((x) => x !== u))} accessibilityRole="button" accessibilityLabel={t('removePhoto', lang)}>
              <Text style={s.remove}>{t('removePhoto', lang)}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {uris.length < MAX_PHOTOS && (
        <TouchableOpacity style={s.btn} onPress={add} accessibilityRole="button">
          <Text style={s.btnText}>📷 {t('addPhoto', lang)}</Text>
        </TouchableOpacity>
      )}
      {uris.length > 0 && <Text style={s.note}>{t('photoNote', lang)}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 12 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  thumbWrap: { alignItems: 'center' },
  thumb: { width: 64, height: 64, borderRadius: 8 },
  remove: { color: '#e94560', fontSize: 11, marginTop: 2 },
  btn: { alignSelf: 'flex-start', marginTop: 8, borderWidth: 1, borderColor: '#e94560', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  btnText: { color: '#e94560', fontWeight: '600', fontSize: 13 },
  note: { fontSize: 11, color: '#888', marginTop: 6 },
});
