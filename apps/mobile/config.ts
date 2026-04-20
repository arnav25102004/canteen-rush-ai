const DEV_API_URL = 'http://192.168.1.100:3001/api'; // replace with your local IP when testing locally
const PROD_API_URL = 'https://canteen-rush-ai.onrender.com/api';

export const CONFIG = {
  API_URL: __DEV__ ? DEV_API_URL : PROD_API_URL,
  RAZORPAY_KEY_ID: 'rzp_test_SaZwAB00UJ9H22',
};
