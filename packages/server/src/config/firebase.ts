import admin from 'firebase-admin';
import path from 'path';

if (!admin.apps.length) {
  let initialized = false;

  // Try 1: JSON file (local dev)
  try {
    const serviceAccount = require(path.resolve(__dirname, '../../firebase-service-account.json'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('Firebase Admin initialized via JSON file ✅');
  } catch {}

  // Try 2: Environment variables (production)
  if (!initialized && process.env.FIREBASE_PROJECT_ID) {
    try {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY
        ?.replace(/\\n/g, '\n')
        .replace(/\r/g, '');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
      initialized = true;
      console.log('Firebase Admin initialized via env vars ✅');
    } catch (err) {
      console.warn('Firebase env var init failed:', (err as Error).message);
    }
  }

  if (!initialized) {
    console.warn('Firebase not configured — using mock auth mode');
  }
}

export const firebaseAdmin = admin;

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    // Dev mock token: dev.<base64payload>.mock — always bypass Firebase verification
    if (token.startsWith('dev.') && token.endsWith('.mock')) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || 'e30=', 'base64').toString());
      return payload as admin.auth.DecodedIdToken;
    }
    if (!admin.apps.length) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || 'e30=', 'base64').toString());
      payload.uid = payload.uid || payload.user_id || payload.sub;
      return payload as admin.auth.DecodedIdToken;
    }
    try {
      return await admin.auth().verifyIdToken(token);
    } catch (verifyErr) {
      // In dev, fall back to parsing JWT payload without cryptographic verification
      if (process.env.NODE_ENV !== 'production') {
        const payload = JSON.parse(Buffer.from(token.split('.')[1] || 'e30=', 'base64').toString());
        if (payload?.uid || payload?.user_id || payload?.sub) {
          payload.uid = payload.uid || payload.user_id || payload.sub;
          return payload as admin.auth.DecodedIdToken;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
}

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> {
  try {
    if (!admin.apps.length) return false;
    await admin.messaging().send({ token: fcmToken, notification: { title, body }, data });
    return true;
  } catch (err) {
    console.error('FCM send error:', err);
    return false;
  }
}
