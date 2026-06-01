import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBDLdPgGAcH3PUmWj1g7WeGfLSOrCYAAa4",
  authDomain: "christeats-83cb9.firebaseapp.com",
  projectId: "christeats-83cb9",
  storageBucket: "christeats-83cb9.firebasestorage.app",
  messagingSenderId: "875240490155",
  appId: "1:875240490155:web:e8bef4c047a0d658e563ee",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

export { app, auth };
