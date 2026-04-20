'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [popular, setPopular] = useState<any[]>([]);
  const [peakHours, setPeakHours] = useState<any[]>([]);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');

  useEffect(() => {
    Promise.all([
      api.get(`/analytics/vendor/summary?period=${period}`).then(r => setSummary(r.data)),
      api.get('/analytics/vendor/popular-items').then(r => setPopular(r.data.items || [])),
      api.get('/analytics/vendor/peak-hours').then(r => setPeakHours(r.data.peakHours || [])),
    ]).catch(console.error);
  }, [period]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Analytics</h1>
          <div className="flex gap-2">
            {(['today', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${period === p ? 'bg-[#1a1a2e] text-white' : 'bg-white text-gray-600 border'}`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Orders', value: summary?.totalOrders ?? '—' },
            { label: 'Revenue', value: summary?.totalRevenue ? `₹${summary.totalRevenue.toFixed(0)}` : '—' },
            { label: 'Avg Prep Time', value: summary?.avgPrepTimeMinutes ? `${summary.avgPrepTimeMinutes} min` : '—' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-6 shadow-sm">
              <p className="text-2xl font-bold text-gray-800">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-semibold mb-4 text-gray-700">Top Selling Items</h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={popular.slice(0, 8)}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="totalOrders" fill="#e94560" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-semibold mb-4 text-gray-700">Peak Hours</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={peakHours}>
                <XAxis dataKey="hour" tickFormatter={h => `${h}:00`} tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip labelFormatter={h => `${h}:00`} />
                <Line dataKey="count" stroke="#1a1a2e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </main>
    </div>
  );
}
