import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAxiosError } from 'axios';
import api, { registerSessionExpiredHandler } from '../services/api';
import { resetSocket } from '../services/socket';
import { auth } from '../firebaseConfig';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut, updateProfile } from 'firebase/auth';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  canteenId?: string;
  campus?: string;
  dietPreference?: string;
  institutionId?: string;
}

export interface Institution {
  id: string;
  name: string;
  slug: string;
  emailDomain: string;
  logoUrl?: string;
  city?: string;
}

interface AuthStore {
  user: AppUser | null;
  institution: Institution | null;
  isLoaded: boolean;
  loadFromStorage: () => Promise<void>;
  setInstitution: (inst: Institution) => Promise<void>;
  switchInstitution: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: string;
  vendorCanteen?: { id: string } | null;
  campus?: string;
  dietPreference?: string;
  institutionId?: string;
}

export function mapUser(dataUser: ApiUser): AppUser {
  return {
    id: dataUser.id,
    name: dataUser.name,
    email: dataUser.email,
    role: dataUser.role,
    canteenId: dataUser.vendorCanteen?.id ?? undefined,
    campus: dataUser.campus,
    dietPreference: dataUser.dietPreference,
    institutionId: dataUser.institutionId,
  };
}

export class EmailNotVerifiedError extends Error {
  constructor() {
    super('Please verify your email first. Open the verification link we emailed you, then sign in again.');
    this.name = 'EmailNotVerifiedError';
  }
}

const RESEND_COOLDOWN_MS = 60_000;
let lastResendAt = 0;

/** Signs in just long enough to resend the verification mail. Returns seconds to wait if throttled. */
export async function resendVerificationEmail(email: string, password: string): Promise<number> {
  const wait = Math.ceil((lastResendAt + RESEND_COOLDOWN_MS - Date.now()) / 1000);
  if (wait > 0) return wait;
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try {
    if (!cred.user.emailVerified) {
      lastResendAt = Date.now();
      await sendEmailVerification(cred.user);
    }
  } finally {
    await signOut(auth).catch(() => {});
  }
  return 0;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  institution: null,
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      const [rawUser, rawInst] = await AsyncStorage.multiGet(['user', 'institution']);
      const user = rawUser[1] ? (JSON.parse(rawUser[1]) as AppUser) : null;
      const institution = rawInst[1] ? (JSON.parse(rawInst[1]) as Institution) : null;
      set({ user, institution, isLoaded: true });
    } catch {
      set({ user: null, institution: null, isLoaded: true });
    }
  },

  setInstitution: async (inst) => {
    await AsyncStorage.setItem('institution', JSON.stringify(inst));
    set({ institution: inst });
  },

  switchInstitution: async () => {
    await AsyncStorage.removeItem('institution');
    set({ institution: null });
  },

  login: async (email, password) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    // The server rejects tokens for unverified emails — catch it here with a clear message.
    // Never send mail from here: each failed login would trigger another
    // verification email and Firebase soon answers auth/too-many-requests.
    // The login screen offers an explicit "Resend" button with a cooldown.
    if (!userCredential.user.emailVerified) {
      await signOut(auth);
      throw new EmailNotVerifiedError();
    }
    const token = await userCredential.user.getIdToken();

    try {
      const { data } = await api.get<{ user: ApiUser }>('/auth/me');
      const user = mapUser(data.user);
      await AsyncStorage.setItem('user', JSON.stringify(user));
      set({ user });
    } catch (error: unknown) {
      if (isAxiosError(error) && (error.response?.status === 404 || error.response?.status === 401)) {
        const { data } = await api.post<{ user: ApiUser }>('/auth/register', {
          firebaseToken: token,
          name: userCredential.user.displayName || email.split('@')[0],
        });
        const user = mapUser(data.user);
        await AsyncStorage.setItem('user', JSON.stringify(user));
        set({ user });
      } else {
        throw error;
      }
    }
  },

  // Creates the Firebase account and sends a verification email. The backend
  // account is created on first login, once the email is verified.
  register: async (name, email, password) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(userCredential.user, { displayName: name });
    await sendEmailVerification(userCredential.user);
    await signOut(auth);
  },

  logout: async () => {
    resetSocket();
    await signOut(auth).catch(() => {});
    await AsyncStorage.multiRemove(['user', 'auth_token', 'institution']);
    set({ user: null, institution: null });
  },
}));

// 401 that survives a token refresh = dead session. Clear it; the root layout's
// auth guard then routes to login. Keeps the chosen institution.
registerSessionExpiredHandler(async () => {
  if (!useAuthStore.getState().user) return;
  resetSocket();
  await signOut(auth).catch(() => {});
  await AsyncStorage.removeItem('user');
  useAuthStore.setState({ user: null });
});
