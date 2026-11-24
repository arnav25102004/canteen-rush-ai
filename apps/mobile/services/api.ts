import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { auth } from '../firebaseConfig';
import { CONFIG } from '../config';

declare module 'axios' {
  interface AxiosRequestConfig {
    _authRetried?: boolean;
    _netRetried?: boolean;
  }
}

const api = axios.create({
  baseURL: CONFIG.API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// The auth store registers its sign-out here, so this module never imports the
// store (avoids an api <-> authStore import cycle).
let onSessionExpired: (() => void | Promise<void>) | null = null;
export function registerSessionExpiredHandler(fn: () => void | Promise<void>) {
  onSessionExpired = fn;
}

api.interceptors.request.use(async (config) => {
  // On a cold start Firebase restores the saved login asynchronously. Without
  // waiting, early requests go out with no token, get a 401, and the handler
  // below signs the user out even though their session is fine.
  await auth.authStateReady();
  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    // Cached token; Firebase refreshes it automatically when near expiry.
    const token = await firebaseUser.getIdToken();
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

const IDEMPOTENT = ['get', 'head'];

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig | undefined;
    if (!config) return Promise.reject(error);
    const status = error.response?.status;

    // 401: retry once with a force-refreshed token. The retried request runs
    // through this interceptor again; if it 401s too, the branch below signs out.
    if (status === 401) {
      const user = auth.currentUser;
      if (!config._authRetried && user) {
        config._authRetried = true;
        try {
          config.headers['Authorization'] = `Bearer ${await user.getIdToken(true)}`;
        } catch {
          return Promise.reject(error);
        }
        return api(config);
      }
      // /auth/* 401s are handled by the login flow itself (not registered yet).
      if (!config.url?.startsWith('/auth/')) await onSessionExpired?.();
      return Promise.reject(error);
    }

    // Cold-start timeout / 503: retry once, only for idempotent requests. Placing an
    // order qualifies because checkout sends a clientRequestId the server de-duplicates on.
    const method = (config.method ?? 'get').toLowerCase();
    if (
      (IDEMPOTENT.includes(method) || (method === 'post' && config.url === '/orders')) &&
      !config._netRetried &&
      (error.code === 'ECONNABORTED' || status === 503)
    ) {
      config._netRetried = true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return api(config);
    }
    return Promise.reject(error);
  }
);

export default api;
