'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#e94560', '#1a1a2e', '#10b981', '#3b82f6', '#f59e0b'];

export default function AdminAnalyticsPage() {
  const [overview, setOverview] = useState<any>(null);
  const [canteenRevenue, setCanteenRevenue] = useState<any[]>([]);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');

  useEffect(() => {
    Promise.all([
      api.get('/analytics/admin/overview').then(r => setOverview(r.data)),
      api.get(`/analytics/admin/canteen-revenue?period=${period}`).then(r => setCanteenRevenue(r.data.canteens || [])),
    ]).catch(console.error);
  }, [period]);

  const totalRevenue = canteenRevenue.reduce((sum, c) => sum + (c.revenue || 0), 0);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Platform Analytics</h1>
          <div className="flex gap-2">
            {(['today', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${period === p ? 'bg-[#1a1a2e] text-white' : 'bg-white text-gray-600 border'}`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Orders', value: overview?.totalOrders ?? '—', icon: '📋' },
            { label: 'Total Revenue', value: totalRevenue > 0 ? `₹${totalRevenue.toFixed(0)}` : (overview?.totalRevenue ? `₹${Number(overview.totalRevenue).toFixed(0)}` : '—'), icon: '💰' },
            { label: 'Active Canteens', value: overview?.activeCanteens ?? '—', icon: '🏪' },
            { label: 'Avg Order Value', value: overview?.totalOrders && overview?.totalRevenue ? `₹${(Number(overview.totalRevenue) / Number(overview.totalOrders)).toFixed(0)}` : '—', icon: '📊' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-6 shadow-sm">
              <p className="text-2xl mb-2">{s.icon}</p>
              <p className="text-2xl font-bold text-gray-800">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Revenue by Canteen Bar Chart */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-semibold mb-4 text-gray-700">Revenue by Canteen</h2>
            {canteenRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={canteenRevenue}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `₹${v}`} />
                  <Tooltip formatter={(v: any) => `₹${Number(v).toFixed(0)}`} />
                  <Bar dataKey="revenue" fill="#e94560" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">No data for this period</div>
            )}
          </div>

          {/* Orders Share Pie Chart */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-semibold mb-4 text-gray-700">Orders Share by Canteen</h2>
            {canteenRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={canteenRevenue} dataKey="orders" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {canteenRevenue.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">No data for this period</div>
            )}
          </div>
        </div>

        {/* Canteens Table */}
        <div className="bg-white rounded-xl shadow-sm mt-6 overflow-hidden">
          <div className="p-6 border-b font-semibold text-gray-700">All Canteens — Performance ({period})</div>
          <div className="divide-y">
            {overview?.canteens?.map((c: any) => (
              <div key={c.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-800">{c.name}</p>
                  <p className="text-sm text-gray-500">{c.campus}</p>
                </div>
                <div className="flex items-center gap-8 text-sm">
                  <div className="text-right">
                    <p className="font-semibold text-gray-700">{c._count.orders}</p>
                    <p className="text-gray-400">orders today</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {c.isActive ? 'Active' : 'Closed'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
