import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { auth } from '../firebaseConfig';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { CONFIG } from '../config';

// Auto-refresh Firebase token on every request
axios.interceptors.request.use(async (config) => {
  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    // getIdToken(false) returns cached token if still valid, refreshes if about to expire
    const freshToken = await firebaseUser.getIdToken(false);
    config.headers['Authorization'] = `Bearer ${freshToken}`;
    await AsyncStorage.setItem('auth_token', freshToken);
  }
  return config;
});

// On 401, clear session so user is sent back to login
axios.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.multiRemove(['user', 'auth_token']);
      delete axios.defaults.headers.common['Authorization'];
      useAuthStore.setState({ user: null, token: null });
    }
    return Promise.reject(error);
  },
);

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
  token: string | null;
  institution: Institution | null;
  isLoaded: boolean;
  loadFromStorage: () => Promise<void>;
  setInstitution: (inst: Institution) => Promise<void>;
  switchInstitution: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function applyToken(token: string | null) {
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common['Authorization'];
  }
}

function mapUser(dataUser: any): AppUser {
  return {
    id: dataUser.id,
    name: dataUser.name,
    email: dataUser.email,
    role: dataUser.role,
    canteenId: dataUser.vendorCanteen?.id,
    campus: dataUser.campus,
    dietPreference: dataUser.dietPreference,
    institutionId: dataUser.institutionId,
  };
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  institution: null,
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      const [rawUser, rawToken, rawInst] = await AsyncStorage.multiGet(['user', 'auth_token', 'institution']);
      const user = rawUser[1] ? (JSON.parse(rawUser[1]) as AppUser) : null;
      const token = rawToken[1] ?? null;
      const institution = rawInst[1] ? (JSON.parse(rawInst[1]) as Institution) : null;
      applyToken(token);
      set({ user, token, institution, isLoaded: true });
    } catch {
      set({ user: null, token: null, institution: null, isLoaded: true });
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
    const token = await userCredential.user.getIdToken();
    applyToken(token);

    try {
      const { data } = await axios.get(`${CONFIG.API_URL}/auth/me`);
      const user = mapUser(data.user);
      await AsyncStorage.multiSet([['user', JSON.stringify(user)], ['auth_token', token]]);
      set({ user, token });
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 401) {
        const { data } = await axios.post(`${CONFIG.API_URL}/auth/register`, {
          firebaseToken: token,
          name: email.split('@')[0],
          email,
          role: 'STUDENT',
        });
        const user = mapUser(data.user);
        await AsyncStorage.multiSet([['user', JSON.stringify(user)], ['auth_token', token]]);
        set({ user, token });
      } else {
        throw error;
      }
    }
  },

  register: async (name, email, password) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();
    applyToken(token);

    const { data } = await axios.post(`${CONFIG.API_URL}/auth/register`, {
      firebaseToken: token,
      name,
      email,
      role: 'STUDENT',
    });
    const user = mapUser(data.user);
    await AsyncStorage.multiSet([['user', JSON.stringify(user)], ['auth_token', token]]);
    set({ user, token });
  },

  logout: async () => {
    applyToken(null);
    await AsyncStorage.multiRemove(['user', 'auth_token', 'institution']);
    set({ user: null, token: null, institution: null });
  },
}));
