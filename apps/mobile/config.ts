export const CONFIG = {
  API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://canteen-rush-ai.onrender.com/api',
  // KEY_ID is public — safe to expose. Secret key lives on the backend only.
  RAZORPAY_KEY_ID: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || '',
};
