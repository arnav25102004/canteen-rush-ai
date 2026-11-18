'use client';
import { useCallback, useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ItemRating { item: string | null; rating: number; taste: number | null; portion: number | null; value: number | null; tags: string[] }
interface Item {
  id: string;
  kind: string;
  rating: number | null;
  tags: string[];
  text: string | null;
  day: string;
  items: ItemRating[];
  photos: string[];
  reply: { text: string; by: string | null; day: string } | null;
}
interface Summary {
  days: number;
  trend: { day: string; avg: number; count: number }[];
  topTags: { tag: string; count: number }[];
  total: number;
  avg: number | null;
}

const PAGE = 20;
const label = (t: string) => t.replace(/_/g, ' ');

function Stars({ n }: { n: number | null }) {
  if (n == null) return null;
  return <span className="text-amber-500" aria-label={`${n} out of 5`}>{'★'.repeat(n)}<span className="text-gray-300">{'★'.repeat(5 - n)}</span></span>;
}

export default function VendorFeedbackPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        api.get('/vendor/feedback', { params: { page, limit: PAGE } }),
        api.get('/vendor/feedback/summary', { params: { days: 30 } }),
      ]);
      setItems(list.data.feedback ?? []);
      setTotal(list.data.total ?? 0);
      setSummary(sum.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not load feedback');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  async function reply(id: string) {
    const text = (drafts[id] ?? '').trim();
    if (!text) return;
    setBusy(id);
    try {
      const { data } = await api.post(`/vendor/feedback/${id}/reply`, { text });
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, reply: data.reply } : i)));
    } catch (e: any) {
      setNotice((n) => ({ ...n, [id]: e?.response?.data?.error || 'Could not send reply' }));
    } finally {
      setBusy(null);
    }
  }

  async function flag(id: string) {
    const reason = window.prompt('Why is this feedback unfair? (optional, admins will review it)') ?? null;
    if (reason === null) return;
    setBusy(id);
    try {
      await api.post(`/vendor/feedback/${id}/flag-unfair`, { reason });
      setNotice((n) => ({ ...n, [id]: 'Sent to admins for review. Nothing was hidden.' }));
    } catch (e: any) {
      setNotice((n) => ({ ...n, [id]: e?.response?.data?.error || 'Could not flag' }));
    } finally {
      setBusy(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">Feedback</h1>
        <p className="text-sm text-gray-500 mb-6">
          What students say about your canteen. Names, order numbers and exact times are never shown. Low ratings appear a few hours after they are posted.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-2xl font-bold text-gray-800">{summary?.avg ?? '—'}</p>
            <p className="text-sm text-gray-500">Average rating, last 30 days</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-2xl font-bold text-gray-800">{summary?.total ?? '—'}</p>
            <p className="text-sm text-gray-500">Ratings, last 30 days</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-sm text-gray-500 mb-2">Top tags</p>
            <div className="flex flex-wrap gap-1">
              {(summary?.topTags ?? []).length === 0 && <span className="text-sm text-gray-400">None yet</span>}
              {(summary?.topTags ?? []).map((t) => (
                <span key={t.tag} className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-1">{label(t.tag)} · {t.count}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="font-semibold mb-4 text-gray-700">Mood trend (average rating per day)</h2>
          {summary && summary.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={summary.trend}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis domain={[1, 5]} allowDecimals={false} />
                <Tooltip formatter={(v, name) => [v, name === 'avg' ? 'Average' : 'Ratings']} />
                <Line dataKey="avg" stroke="#e94560" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">Not enough ratings yet.</p>
          )}
        </div>

        {error && <p className="text-red-600 text-sm mb-4" role="alert">{error}</p>}
        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {!loading && !error && items.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">No feedback to show yet.</div>
        )}

        <div className="space-y-4">
          {items.map((f) => (
            <article key={f.id} className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between">
                <Stars n={f.rating} />
                <span className="text-xs text-gray-400">{f.day}</span>
              </div>
              {f.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {f.tags.map((t) => <span key={t} className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{label(t)}</span>)}
                </div>
              )}
              {f.text && <p className="mt-3 text-gray-800 whitespace-pre-wrap">{f.text}</p>}
              {f.items.length > 0 && (
                <ul className="mt-3 text-sm text-gray-600 space-y-1">
                  {f.items.map((i, k) => (
                    <li key={k}>
                      <span className="font-medium">{i.item ?? 'Item'}</span> <Stars n={i.rating} />
                      {(i.taste || i.portion || i.value) && (
                        <span className="text-xs text-gray-400 ml-2">
                          {i.taste ? `taste ${i.taste}` : ''} {i.portion ? `portion ${i.portion}` : ''} {i.value ? `value ${i.value}` : ''}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {f.photos.length > 0 && (
                <div className="flex gap-2 mt-3">
                  {f.photos.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="Photo from a student" className="w-20 h-20 object-cover rounded-lg" />
                  ))}
                </div>
              )}

              {f.reply ? (
                <div className="mt-4 bg-green-50 rounded-lg p-3 text-sm">
                  <p className="text-xs font-semibold text-green-700">Your public reply · {f.reply.day}</p>
                  <p className="text-gray-800 mt-1">{f.reply.text}</p>
                </div>
              ) : (
                <div className="mt-4">
                  <textarea
                    value={drafts[f.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
                    maxLength={300}
                    rows={2}
                    placeholder="Write one public reply (max 300 characters)"
                    aria-label="Public reply"
                    className="w-full border rounded-lg p-2 text-sm"
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => reply(f.id)}
                      disabled={busy === f.id || !(drafts[f.id] ?? '').trim()}
                      className="px-4 py-2 bg-[#1a1a2e] text-white text-sm rounded-lg disabled:opacity-50"
                    >
                      Reply
                    </button>
                    <span className="text-xs text-gray-400">{(drafts[f.id] ?? '').length}/300. You can reply once.</span>
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => flag(f.id)} disabled={busy === f.id} className="text-xs text-gray-500 underline disabled:opacity-50">
                  Flag as unfair
                </button>
                {notice[f.id] && <span className="text-xs text-gray-600" role="status">{notice[f.id]}</span>}
              </div>
            </article>
          ))}
        </div>

        {pages > 1 && (
          <div className="flex items-center gap-3 mt-6">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-40 bg-white">Previous</button>
            <span className="text-sm text-gray-600">Page {page} of {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="px-3 py-1 border rounded disabled:opacity-40 bg-white">Next</button>
          </div>
        )}
      </main>
    </div>
  );
}
