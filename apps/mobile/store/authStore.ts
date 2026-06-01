import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { auth } from '../firebaseConfig';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  canteenId?: string;
  campus?: string;
  dietPreference?: string;
}

interface AuthStore {
  user: AppUser | null;
  token: string | null;
  isLoaded: boolean;
  loadFromStorage: () => Promise<void>;
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
  };
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      const [rawUser, rawToken] = await AsyncStorage.multiGet(['user', 'auth_token']);
      const user = rawUser[1] ? (JSON.parse(rawUser[1]) as AppUser) : null;
      const token = rawToken[1] ?? null;
      applyToken(token);
      set({ user, token, isLoaded: true });
    } catch {
      set({ user: null, token: null, isLoaded: true });
    }
  },

  login: async (email, password) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();
    applyToken(token);

    try {
      const { data } = await axios.get(`${API_URL}/api/auth/me`);
      const user = mapUser(data.user);
      await AsyncStorage.multiSet([['user', JSON.stringify(user)], ['auth_token', token]]);
      set({ user, token });
    } catch (error: any) {
      if (error.response?.status === 404 || error.response?.status === 401) {
        const { data } = await axios.post(`${API_URL}/api/auth/register`, {
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

    const { data } = await axios.post(`${API_URL}/api/auth/register`, {
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
    await AsyncStorage.multiRemove(['user', 'auth_token']);
    set({ user: null, token: null });
  },
}));
