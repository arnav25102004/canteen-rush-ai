import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({ baseURL: API_URL });

// Attach stored user_id to every request so backend can identify the caller
api.interceptors.request.use(async (config) => {
  const userId = await AsyncStorage.getItem('user_id');
  if (userId) {
    config.headers['x-user-id'] = userId;
  }
  return config;
});

export default api;
