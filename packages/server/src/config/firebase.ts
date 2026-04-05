import admin from 'firebase-admin';

if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('Firebase not configured — auth will use mock mode in development');
  } else {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
}

export const firebaseAdmin = admin;

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken | null> {
  try {
    if (!admin.apps.length || !process.env.FIREBASE_PROJECT_ID) {
      // Dev mock: parse the token as plain JSON (for testing without Firebase)
      const payload = JSON.parse(Buffer.from(token.split('.')[1] || 'e30=', 'base64').toString());
      return payload as admin.auth.DecodedIdToken;
    }
    return await admin.auth().verifyIdToken(token);
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
    if (!admin.apps.length || !process.env.FIREBASE_PROJECT_ID) return false;
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
    });
    return true;
  } catch (err) {
    console.error('FCM send error:', err);
    return false;
  }
}
