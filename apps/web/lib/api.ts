import axios from 'axios';
import { auth } from './firebase';

const api = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_API_URL || 'https://canteen-rush-ai.onrender.com'}/api`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Firebase ID tokens expire after an hour. Ask Firebase for the current one
// (it refreshes when near expiry) instead of reusing the token saved at login.
api.interceptors.request.use(async (config) => {
  if (typeof window === 'undefined') return config;
  let token: string | null = null;
  if (auth) {
    await auth.authStateReady();
    token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  }
  token = token ?? localStorage.getItem('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
