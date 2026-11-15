import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { signOut } from 'firebase/auth';
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

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

function redirectToLogin() {
  localStorage.clear();
  window.location.href = '/login';
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const config = err.config as RetriableConfig | undefined;
    if (err.response?.status !== 401 || typeof window === 'undefined' || !config) {
      return Promise.reject(err);
    }
    // Retry once with a force-refreshed Firebase token before giving up.
    if (!config._retried && auth?.currentUser) {
      config._retried = true;
      try {
        const fresh = await auth.currentUser.getIdToken(true);
        config.headers.Authorization = `Bearer ${fresh}`;
        return await api.request(config);
      } catch (retryErr) {
        if (!(axios.isAxiosError(retryErr) && retryErr.response?.status === 401)) {
          return Promise.reject(retryErr);
        }
      }
    }
    // The login page handles its own 401s (e.g. first-login registration).
    if (window.location.pathname === '/login') return Promise.reject(err);
    if (auth) await signOut(auth).catch(() => undefined);
    redirectToLogin();
    return Promise.reject(err);
  }
);

export default api;