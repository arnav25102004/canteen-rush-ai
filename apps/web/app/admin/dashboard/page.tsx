'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

export default function AdminDashboard() {
  const [overview, setOverview] = useState<any>(null);

  useEffect(() => {
    api.get('/analytics/admin/overview').then(r => setOverview(r.data)).catch(console.error);
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Admin Dashboard</h1>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Orders (All Time)', value: overview?.totalOrders ?? '—', icon: '📋' },
            { label: 'Total Revenue', value: overview?.totalRevenue ? `₹${Number(overview.totalRevenue).toFixed(0)}` : '—', icon: '💰' },
            { label: 'Active Canteens', value: overview?.activeCanteens ?? '—', icon: '🏪' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-6 shadow-sm">
              <p className="text-2xl mb-2">{s.icon}</p>
              <p className="text-2xl font-bold text-gray-800">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-6 border-b font-semibold text-gray-700">Canteens Overview (Last 24h)</div>
          <div className="divide-y">
            {overview?.canteens?.map((c: any) => (
              <div key={c.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-gray-500">{c.campus}</p>
                </div>
                <span className="text-sm font-semibold text-gray-700">{c._count.orders} orders today</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
