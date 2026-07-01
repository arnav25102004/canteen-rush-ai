import axios from 'axios';
import { auth } from '../firebaseConfig';
import { CONFIG } from '../config';

const api = axios.create({
  baseURL: CONFIG.API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const firebaseUser = auth.currentUser;
  if (firebaseUser) {
    // Always get a fresh/cached token — Firebase auto-refreshes if near expiry
    const token = await firebaseUser.getIdToken(false);
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Retry once on cold-start timeout or 503 (Render free tier waking up)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if ((error.code === 'ECONNABORTED' || error.response?.status === 503) && !config._retry) {
      config._retry = true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return api(config);
    }
    return Promise.reject(error);
  }
);

export default api;
