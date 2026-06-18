'use client';
export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import api from '../../lib/api';

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
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const token = await credential.user.getIdToken();

      localStorage.setItem('auth_token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      let userData;
      try {
        const { data } = await api.get('/auth/me');
        userData = data.user;
      } catch (meErr: any) {
        if (meErr?.response?.status === 401) {
          // First login — register in DB
          const role = email.toLowerCase().includes('admin') ? 'ADMIN' : 'VENDOR';
          const { data } = await api.post('/auth/register', { firebaseToken: token, email, role });
          userData = data.user;
        } else {
          throw meErr;
        }
      }

      const user = userData;

      localStorage.setItem('user_role', user.role);
      localStorage.setItem('user_id', user.id);

      if (user.role === 'ADMIN') router.push('/admin/dashboard');
      else router.push('/vendor/dashboard');
    } catch (e: any) {
      const code = e?.code;
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Invalid email or password.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many attempts. Please try again later.');
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
          <h1 className="text-3xl font-bold text-[#1a1a2e]">CanteenRush</h1>
          <p className="text-gray-500 mt-1">Vendor & Admin Portal</p>
          <p className="text-xs text-amber-500 mt-2">Use your institution email</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#e94560]"
              placeholder="vendor@university.in" required
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
