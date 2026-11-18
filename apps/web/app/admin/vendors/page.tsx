'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

export default function VendorsPage() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [canteens, setCanteens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    await Promise.all([
      api.get('/admin/vendors').then(r => setVendors(r.data.vendors || [])),
      api.get('/canteens').then(r => setCanteens(r.data.canteens || [])),
    ]).catch(console.error);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function vendorOf(canteenId: string) {
    const canteen = canteens.find((c: any) => c.id === canteenId);
    return vendors.find((v: any) => v.id === canteen?.vendorId);
  }

  async function assign(vendorId: string) {
    const canteenId = choice[vendorId];
    if (!canteenId) return;
    setBusy(vendorId); setMessage('');
    try {
      await api.post('/admin/vendors/assign', { vendorId, canteenId });
      setChoice(c => ({ ...c, [vendorId]: '' }));
      await load();
      setMessage('Vendor assigned.');
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Could not assign vendor.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(vendorId: string) {
    setBusy(vendorId); setMessage('');
    try {
      await api.post('/admin/vendors/unassign', { vendorId });
      await load();
      setMessage('Vendor removed from canteen.');
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Could not remove vendor.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Vendor Management</h1>

        {message && <p className="mb-4 text-sm text-gray-700">{message}</p>}

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b">
            <p className="text-sm text-gray-500">{vendors.length} vendors registered</p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : vendors.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No vendors found</div>
          ) : (
            <div className="divide-y">
              {vendors.map((v: any) => (
                <div key={v.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">
                      {v.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{v.name}</p>
                      <p className="text-sm text-gray-500">{v.email}</p>
                      {v.vendorCanteen ? (
                        <p className="text-xs text-indigo-600 mt-0.5">🏪 {v.vendorCanteen.name}</p>
                      ) : (
                        <p className="text-xs text-yellow-600 mt-0.5">Not assigned to a canteen</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={choice[v.id] || ''}
                      onChange={(e) => setChoice(c => ({ ...c, [v.id]: e.target.value }))}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Choose canteen…</option>
                      {canteens.map((c: any) => {
                        const current = vendorOf(c.id);
                        return (
                          <option key={c.id} value={c.id}>
                            {c.name}{current && current.id !== v.id ? ` (now: ${current.email})` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      onClick={() => assign(v.id)}
                      disabled={!choice[v.id] || busy === v.id}
                      className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#e94560] text-white disabled:opacity-40"
                    >
                      Assign
                    </button>
                    {v.vendorCanteen && (
                      <button
                        onClick={() => remove(v.id)}
                        disabled={busy === v.id}
                        className="px-3 py-2 rounded-lg text-sm font-semibold border border-red-300 text-red-600 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
