const DEV_API_URL = 'https://canteen-rush-ai.onrender.com/api';
const PROD_API_URL = 'https://canteen-rush-ai.onrender.com/api';

export const CONFIG = {
  API_URL: __DEV__ ? DEV_API_URL : PROD_API_URL,
  RAZORPAY_KEY_ID: 'rzp_test_SaZwAB00UJ9H22',
};
