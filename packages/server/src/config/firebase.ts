import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import path from 'path';

if (!getApps().length) {
  let initialized = false;

  // Try 1: JSON file (local dev)
  try {
    const serviceAccount = require(path.resolve(__dirname, '../../firebase-service-account.json'));
    initializeApp({ credential: cert(serviceAccount) });
    initialized = true;
    console.log('Firebase Admin initialized via JSON file ✅');
  } catch {}

  // Try 2: Environment variables (production)
  if (!initialized && process.env.FIREBASE_PROJECT_ID) {
    try {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY
        ?.replace(/\\n/g, '\n')
        .replace(/\r/g, '');
      initializeApp({
        credential: cert({
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
    console.warn('Firebase not configured — all real tokens will be rejected');
  }
}

/** Remove the Firebase Auth account (used by in-app account deletion). */
export async function deleteFirebaseUser(uid: string): Promise<void> {
  if (!getApps().length) return;
  await getAuth().deleteUser(uid);
}

/**
 * Local-dev escape hatch: `dev.<base64 JSON>.mock` tokens skip Firebase.
 * Requires BOTH a non-production NODE_ENV and an explicit DEV_AUTH=true, so a
 * misconfigured production box can never accept forged identities.
 */
export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH === 'true';
}

export async function verifyFirebaseToken(token: string): Promise<DecodedIdToken | null> {
  try {
    if (token.startsWith('dev.') && token.endsWith('.mock')) {
      if (!devAuthEnabled()) return null;
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || 'e30=', 'base64').toString());
      return { ...payload, email_verified: true } as DecodedIdToken;
    }
    // Never trust an unverified JWT: without Firebase Admin there is no way to
    // check the signature, so reject instead of decoding the payload blindly.
    if (!getApps().length) return null;
    const decoded = await getAuth().verifyIdToken(token);
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
    if (!getApps().length) return false;
    await getMessaging().send({ token: fcmToken, notification: { title, body }, data });
    return true;
  } catch (err) {
    console.error('FCM send error:', err);
    return false;
  }
}
