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

/**
 * Local-dev escape hatch: `dev.<base64 JSON>.mock` tokens skip Firebase.
 * Requires BOTH a non-production NODE_ENV and an explicit DEV_AUTH=true, so a
 * misconfigured production box can never accept forged identities.
 */
export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === 'true';
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    if (token.startsWith('dev.') && token.endsWith('.mock')) {
      if (!devAuthEnabled()) return null;
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || 'e30=', 'base64').toString());
      return { ...payload, email_verified: true } as admin.auth.DecodedIdToken;
    }
    // Never trust an unverified JWT: without Firebase Admin there is no way to
    // check the signature, so reject instead of decoding the payload blindly.
    if (!admin.apps.length) return null;
    const decoded = await admin.auth().verifyIdToken(token);
    // Only verified inboxes count as an identity — otherwise anyone could sign
    // up with someone else's college address. Clients check
    // user.emailVerified first to show a "verify your email" screen.
    return decoded.email_verified === true ? decoded : null;
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
