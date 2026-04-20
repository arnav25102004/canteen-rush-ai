'use client';
import { useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

interface Settlement {
  id: string;
  canteenId: string;
  canteenName?: string;
  canteen?: { name: string };
  date: string;
  totalOrders: number;
  grossAmount: number;
  platformFee: number;
  netAmount: number;
  isPaid: boolean;
  paidAt?: string;
}

export default function SettlementsPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchSettlements() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/admin/settlements?date=${date}`);
      setSettlements(data.settlements || []);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to load settlements');
    } finally {
      setLoading(false);
    }
  }

  async function markPaid(id: string) {
    try {
      await api.post(`/admin/settlements/${id}/mark-paid`);
      setSettlements(prev => prev.map(s => s.id === id ? { ...s, isPaid: true, paidAt: new Date().toISOString() } : s));
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to mark as paid');
    }
  }

  function exportCSV() {
    const rows = [
      ['Canteen', 'Date', 'Orders', 'Gross (₹)', 'Platform Fee (₹)', 'Net (₹)', 'Status'],
      ...settlements.map(s => [
        s.canteenName || s.canteen?.name || '',
        s.date,
        s.totalOrders,
        Number(s.grossAmount).toFixed(2),
        Number(s.platformFee).toFixed(2),
        Number(s.netAmount).toFixed(2),
        s.isPaid ? 'Paid' : 'Pending',
      ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlements-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalGross = settlements.reduce((s, x) => s + Number(x.grossAmount), 0);
  const totalNet = settlements.reduce((s, x) => s + Number(x.netAmount), 0);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Daily Settlements</h1>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <button onClick={fetchSettlements} disabled={loading}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {loading ? 'Loading…' : 'Generate'}
            </button>
            {settlements.length > 0 && (
              <button onClick={exportCSV}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700">
                Export CSV
              </button>
            )}
          </div>
          {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
        </div>

        {settlements.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl p-5 shadow-sm text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Gross</p>
                <p className="text-2xl font-bold text-gray-800">₹{totalGross.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Platform Fee (2%)</p>
                <p className="text-2xl font-bold text-gray-800">₹{(totalGross - totalNet).toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl p-5 shadow-sm text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net to Vendors</p>
                <p className="text-2xl font-bold text-green-600">₹{totalNet.toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-6 py-3 font-semibold text-gray-600">Canteen</th>
                    <th className="text-right px-6 py-3 font-semibold text-gray-600">Orders</th>
                    <th className="text-right px-6 py-3 font-semibold text-gray-600">Gross</th>
                    <th className="text-right px-6 py-3 font-semibold text-gray-600">Fee (2%)</th>
                    <th className="text-right px-6 py-3 font-semibold text-gray-600">Net</th>
                    <th className="text-center px-6 py-3 font-semibold text-gray-600">Status</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {settlements.map(s => (
                    <tr key={s.id || s.canteenId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-800">{s.canteenName || s.canteen?.name}</td>
                      <td className="px-6 py-4 text-right text-gray-600">{s.totalOrders}</td>
                      <td className="px-6 py-4 text-right text-gray-800">₹{Number(s.grossAmount).toFixed(2)}</td>
                      <td className="px-6 py-4 text-right text-red-500">₹{Number(s.platformFee).toFixed(2)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-green-600">₹{Number(s.netAmount).toFixed(2)}</td>
                      <td className="px-6 py-4 text-center">
                        {s.isPaid
                          ? <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700 font-semibold">Paid</span>
                          : <span className="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-700 font-semibold">Pending</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {!s.isPaid && s.id && (
                          <button onClick={() => markPaid(s.id)}
                            className="px-3 py-1 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700">
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
