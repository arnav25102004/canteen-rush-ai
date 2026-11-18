'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '../../../../components/shared/Sidebar';
import api from '../../../../lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

const MIN_RATINGS = 10;
const RANGES = [7, 30, 90, 180];

const hours = (h: number | null) => (h == null ? '-' : h < 1 ? `${Math.round(h * 60)} min` : `${h} h`);

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="font-semibold mb-4 text-gray-700">{title}</h2>
      {children}
    </div>
  );
}

const Empty = () => <p className="text-sm text-gray-400 py-8 text-center">No data in this range</p>;

export default function FeedbackDashboardPage() {
  const [days, setDays] = useState(30);
  const [grain, setGrain] = useState<'daily' | 'weekly'>('daily');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.get('/admin/feedback/stats/dashboard', { params: { days } })
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e?.response?.data?.error || 'Could not load the dashboard.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const trend = data ? (grain === 'daily'
    ? data.ratingTrend.daily.map((d: any) => ({ label: d.date.slice(5), avg: d.avg, count: d.count }))
    : data.ratingTrend.weekly.map((d: any) => ({ label: d.weekStart.slice(5), avg: d.avg, count: d.count }))) : [];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Feedback insights</h1>
            <Link href="/admin/feedback" className="text-sm text-gray-500 underline">Back to inbox</Link>
          </div>
          <div className="flex gap-2">
            {RANGES.map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${days === d ? 'bg-[#1a1a2e] text-white' : 'bg-white text-gray-600 border'}`}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {loading && !data && <p className="text-gray-400">Loading...</p>}

        {data && (
          <div className={loading ? 'opacity-60' : ''}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-2xl font-bold text-gray-800">{hours(data.response.medianFirstResponseHours)}</p>
                <p className="text-sm text-gray-500">Median first response</p>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-2xl font-bold text-gray-800">{data.response.resolutionRate == null ? '-' : `${data.response.resolutionRate}%`}</p>
                <p className="text-sm text-gray-500">Resolution rate ({data.response.resolved} of {data.response.total})</p>
              </div>
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <p className="text-2xl font-bold text-gray-800">{data.distribution.reduce((a: number, d: any) => a + d.count, 0)}</p>
                <p className="text-sm text-gray-500">Ratings in the last {data.days} days</p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card title="Average rating">
                <div className="flex gap-2 mb-3">
                  {(['daily', 'weekly'] as const).map((g) => (
                    <button key={g} onClick={() => setGrain(g)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium ${grain === g ? 'bg-[#1a1a2e] text-white' : 'bg-white text-gray-600 border'}`}>
                      {g === 'daily' ? 'Daily' : 'Weekly'}
                    </button>
                  ))}
                  <span className="text-xs text-gray-400 self-center">IST days</span>
                </div>
                {trend.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis domain={[1, 5]} fontSize={12} />
                      <Tooltip formatter={(v: any, n: any, p: any) => [`${v} (${p.payload.count} ratings)`, 'Average']} />
                      <Line type="monotone" dataKey="avg" stroke="#e94560" strokeWidth={2} dot={trend.length < 40} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Card>

              <Card title="Rating distribution">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.distribution.map((d: any) => ({ ...d, label: `${d.rating}★` }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#1a1a2e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Top complaint tags">
                {data.topComplaintTags.length ? (
                  <ResponsiveContainer width="100%" height={Math.max(180, data.topComplaintTags.length * 36)}>
                    <BarChart data={data.topComplaintTags} layout="vertical" margin={{ left: 20 }}>
                      <XAxis type="number" allowDecimals={false} fontSize={12} />
                      <YAxis type="category" dataKey="tag" width={100} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#e94560" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Card>

              <Card title="Bugs by app version">
                {data.bugsByVersion.length ? (
                  <ResponsiveContainer width="100%" height={Math.max(180, data.bugsByVersion.length * 36)}>
                    <BarChart data={data.bugsByVersion} layout="vertical" margin={{ left: 20 }}>
                      <XAxis type="number" allowDecimals={false} fontSize={12} />
                      <YAxis type="category" dataKey="version" width={100} fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Card>
            </div>

            <div className="mt-6">
              <Card title="Canteen leaderboard">
                {data.leaderboard.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-left text-gray-500">
                      <tr><th className="py-2 font-medium">#</th><th className="font-medium">Canteen</th><th className="font-medium">Average</th><th className="font-medium">Ratings</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.leaderboard.map((c: any, i: number) => (
                        <tr key={c.canteenId}>
                          <td className="py-2 text-gray-400">{c.sampleSize >= MIN_RATINGS ? i + 1 : ''}</td>
                          <td>{c.name}</td>
                          <td>{c.sampleSize >= MIN_RATINGS && c.avg != null ? `${c.avg}★` : <span className="text-gray-400">Not enough data</span>}</td>
                          <td className="text-gray-600">{c.sampleSize}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <Empty />}
                <p className="text-xs text-gray-400 mt-3">Canteens need at least {MIN_RATINGS} ratings in the range to be ranked. Hidden feedback is excluded.</p>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
