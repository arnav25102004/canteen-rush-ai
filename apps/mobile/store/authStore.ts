import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthStore {
  user: AppUser | null;
  isLoaded: boolean;
  loadFromStorage: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      const user = raw ? (JSON.parse(raw) as AppUser) : null;
      set({ user, isLoaded: true });
    } catch {
      set({ user: null, isLoaded: true });
    }
  },

  login: async (email, password) => {
    const { data } = await axios.post(`${API_URL}/login`, { email, password });
    const user: AppUser = data.user;
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await AsyncStorage.setItem('user_id', user.id);
    set({ user });
  },

  register: async (name, email, password) => {
    const { data } = await axios.post(`${API_URL}/register`, { name, email, password });
    const user: AppUser = data.user;
    await AsyncStorage.setItem('user', JSON.stringify(user));
    await AsyncStorage.setItem('user_id', user.id);
    set({ user });
  },

  logout: async () => {
    await AsyncStorage.multiRemove(['user', 'user_id']);
    set({ user: null });
  },
}));
