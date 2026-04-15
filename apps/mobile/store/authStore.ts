import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

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

/** Apply stored token to all future axios requests */
function applyToken(token: string | null) {
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common['Authorization'];
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      const [rawUser, token] = await AsyncStorage.multiGet(['user', 'auth_token']);
      const user = rawUser[1] ? (JSON.parse(rawUser[1]) as AppUser) : null;
      const tok = token[1] ?? null;
      applyToken(tok);
      set({ user, token: tok, isLoaded: true });
    } catch {
      set({ user: null, token: null, isLoaded: true });
    }
  },

  login: async (email, _password) => {
    // Dev mode: backend creates/finds user and returns a mock token
    const { data } = await axios.post(`${API_URL}/api/auth/dev-login`, { email });
    const user: AppUser = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      role: data.user.role,
      canteenId: data.user.vendorCanteen?.id,
      campus: data.user.campus,
      dietPreference: data.user.dietPreference,
    };
    applyToken(data.token);
    await AsyncStorage.multiSet([
      ['user', JSON.stringify(user)],
      ['auth_token', data.token],
    ]);
    set({ user, token: data.token });
  },

  register: async (name, email, _password) => {
    const { data } = await axios.post(`${API_URL}/api/auth/dev-login`, { email, name });
    const user: AppUser = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      role: data.user.role,
      canteenId: data.user.vendorCanteen?.id,
      campus: data.user.campus,
      dietPreference: data.user.dietPreference,
    };
    applyToken(data.token);
    await AsyncStorage.multiSet([
      ['user', JSON.stringify(user)],
      ['auth_token', data.token],
    ]);
    set({ user, token: data.token });
  },

  logout: async () => {
    applyToken(null);
    await AsyncStorage.multiRemove(['user', 'auth_token']);
    set({ user: null, token: null });
  },
}));
