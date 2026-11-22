'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

const ROLES = ['STUDENT', 'FACULTY', 'VENDOR', 'ADMIN'];
const PAGE_SIZE = 100;
const ROLE_COLORS: Record<string, string> = {
  STUDENT: 'bg-blue-100 text-blue-700',
  FACULTY: 'bg-amber-100 text-amber-700',
  VENDOR: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-red-100 text-red-700',
  SUPER_ADMIN: 'bg-gray-800 text-white',
};

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    loadUsers();
  }, [roleFilter, query]);

  async function loadUsers() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (roleFilter) params.set('role', roleFilter);
      if (query) params.set('q', query);
      const { data } = await api.get(`/admin/users?${params}`);
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setError('');
    } catch {
      setError('Could not load users.');
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    setUpdatingId(userId);
    try {
      const { data } = await api.patch(`/admin/users/${userId}/role`, { role });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: data.user.role } : u));
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to update role');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">User Management</h1>

        <div className="bg-white rounded-xl shadow-sm p-5 mb-6 flex gap-4 flex-wrap items-center">
          <input type="text" placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">All Roles</option>
            {[...ROLES, 'SUPER_ADMIN'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="text-sm text-gray-500">{users.length < total ? `Showing ${users.length} of ${total}. Search to narrow.` : `${total} users`}</span>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No users found</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-6 py-3 font-semibold text-gray-600">User</th>
                  <th className="text-left px-6 py-3 font-semibold text-gray-600">Department</th>
                  <th className="text-left px-6 py-3 font-semibold text-gray-600">Campus</th>
                  <th className="text-left px-6 py-3 font-semibold text-gray-600">Joined</th>
                  <th className="text-left px-6 py-3 font-semibold text-gray-600">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-800">{u.name}</p>
                      <p className="text-xs text-gray-500">{u.email}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{u.department || '—'}</td>
                    <td className="px-6 py-4 text-gray-600">{u.campus || '—'}</td>
                    <td className="px-6 py-4 text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      {u.role === 'SUPER_ADMIN' ? (
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${ROLE_COLORS.SUPER_ADMIN}`}>SUPER_ADMIN</span>
                      ) : (
                        <select
                          value={u.role}
                          onChange={e => changeRole(u.id, e.target.value)}
                          disabled={updatingId === u.id}
                          className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-700'}`}
                        >
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
