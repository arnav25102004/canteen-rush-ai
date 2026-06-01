'use client';
export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';
import { auth } from '../../lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      localStorage.setItem('auth_token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      let user;
      try {
        const { data } = await api.get('/auth/me');
        user = data.user;
      } catch (err: any) {
        if (err.response?.status === 404 || err.response?.status === 401) {
          const fallbackName = email.split('@')[0];
          const role = email.toLowerCase().includes('admin') ? 'ADMIN' : 'VENDOR';
          const { data } = await api.post('/auth/register', { firebaseToken: token, name: fallbackName, email, role });
          user = data.user;
        } else {
          throw err;
        }
      }

      localStorage.setItem('user_role', user.role);
      localStorage.setItem('user_id', user.id);
      if (user.role === 'ADMIN') router.push('/admin/dashboard');
      else router.push('/vendor/dashboard');
    } catch (e: any) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setError('Invalid email or password.');
      } else {
        setError(e?.response?.data?.error || e.message || 'Login failed.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1a1a2e]">Christ Canteen</h1>
          <p className="text-gray-500 mt-1">Vendor & Admin Portal</p>
          <p className="text-xs text-amber-500 mt-2">Use your @christuniversity.in email</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#e94560]"
              placeholder="vendor@christuniversity.in" required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#e94560]"
              placeholder="••••••••" required
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full bg-[#e94560] text-white py-2 rounded-lg font-semibold hover:bg-red-600 transition disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
