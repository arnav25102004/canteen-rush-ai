'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
      // For dev: use test tokens directly
      // In production, exchange Firebase token here
      const role = email.includes('admin') ? 'ADMIN' : 'VENDOR';
      const { data } = await api.post('/auth/dev-login', {
        email,
        name: email.split('@')[0],
        role,
      });

      const user = data.user;
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user_role', user.role);
      localStorage.setItem('user_id', user.id);

      if (user.role === 'ADMIN') router.push('/admin/dashboard');
      else router.push('/vendor/dashboard');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Login failed. Use a @christuniversity.in email.');
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
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#e94560]"
              placeholder="vendor@test.com" required
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

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit" disabled={loading}
            className="w-full bg-[#e94560] text-white py-2 rounded-lg font-semibold hover:bg-red-600 transition disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
          <p className="font-medium mb-1">Test accounts (any password):</p>
          <p>vendor@christuniversity.in → Vendor Dashboard</p>
          <p>admin@christuniversity.in → Admin Panel</p>
        </div>
      </div>
    </div>
  );
}
