import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

/**
 * Optional photo attachments. Cloudinary is off in production: the server then answers 200
 * {degraded:true}, and we hide the "Add photo" button for 24 hours.
 */

const DEGRADED_KEY = 'feedback_photos_degraded_v1';
const DEGRADED_TTL_MS = 24 * 3600 * 1000;
export const MAX_PHOTOS = 3;

export async function photosAvailable(now = Date.now()): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(DEGRADED_KEY);
    if (!raw) return true;
    return now - Number(raw) > DEGRADED_TTL_MS;
  } catch { return true; }
}

export async function markPhotosDegraded(now = Date.now()) {
  try { await AsyncStorage.setItem(DEGRADED_KEY, String(now)); } catch { /* best effort */ }
}

/**
 * Open the system photo picker. No camera and no up-front permission: the picker is only
 * launched when the user taps "Add photo". Returns the local uri or null if cancelled.
 */
export async function pickPhoto(): Promise<string | null> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.7,
    });
    if (res.canceled || !res.assets?.length) return null;
    return res.assets[0].uri;
  } catch { return null; }
}

export type PhotoUploadResult = 'ok' | 'degraded';

export async function uploadFeedbackPhoto(feedbackId: string, uri: string): Promise<PhotoUploadResult> {
  const form = new FormData();
  form.append('image', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
  const { data } = await api.post(`/feedback/${feedbackId}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000,
  });
  if (data?.degraded) {
    await markPhotosDegraded();
    return 'degraded';
  }
  return 'ok';
}
