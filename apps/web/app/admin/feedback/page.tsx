'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

const KINDS = ['ORDER_REVIEW', 'CANTEEN', 'APP_BUG', 'APP_IDEA', 'APP_PRAISE', 'APP_OTHER'];
const STATUSES = ['RECEIVED', 'SEEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'DUPLICATE'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const CLOSED = ['RESOLVED', 'WONT_FIX', 'DUPLICATE'];

// Saved views are just URL presets, so they can be bookmarked and shared.
const VIEWS: { key: string; label: string; params: Record<string, string> }[] = [
  { key: 'all', label: 'All', params: {} },
  { key: 'attention', label: 'Needs attention', params: { needsAttention: 'true' } },
  { key: 'mine', label: 'My assigned', params: { assignee: 'me' } },
  { key: 'payment', label: 'Payment bugs', params: { kind: 'APP_BUG', tag: 'payment' } },
];

const FILTER_KEYS = [
  'kind', 'status', 'priority', 'tag', 'canteenId', 'minRating', 'maxRating', 'from', 'to',
  'hasPhoto', 'anonymous', 'flagged', 'needsAttention', 'assignee',
];

const STATUS_STYLE: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700', SEEN: 'bg-indigo-100 text-indigo-700', IN_PROGRESS: 'bg-orange-100 text-orange-700',
  RESOLVED: 'bg-green-100 text-green-700', WONT_FIX: 'bg-gray-200 text-gray-600', DUPLICATE: 'bg-gray-200 text-gray-600',
};
const PRIORITY_STYLE: Record<string, string> = {
  LOW: 'text-gray-500', NORMAL: 'text-gray-700', HIGH: 'text-orange-600 font-semibold', URGENT: 'text-red-600 font-bold',
};

function ageLabel(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

/** Red when past the SLA deadline, amber in the last quarter of the window, grey otherwise. */
function ageClass(row: { status: string; createdAt: string; slaDueAt: string | null }): string {
  if (CLOSED.includes(row.status) || !row.slaDueAt) return 'bg-gray-100 text-gray-600';
  const now = Date.now();
  const due = new Date(row.slaDueAt).getTime();
  const start = new Date(row.createdAt).getTime();
  if (now > due) return 'bg-red-100 text-red-700';
  if (now > due - (due - start) * 0.25) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function InboxInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canteens, setCanteens] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [meId, setMeId] = useState('');

  const query = sp.toString();

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k); else next.set(k, v);
    }
    router.replace(`/admin/feedback${next.toString() ? `?${next}` : ''}`);
  }, [router, sp]);

  const apiParams = useMemo(() => {
    const p: Record<string, string> = {};
    for (const k of FILTER_KEYS) { const v = sp.get(k); if (v) p[k] = v; }
    return p;
  }, [sp]);

  const load = useCallback(async (more: string | null) => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/admin/feedback', { params: { ...apiParams, limit: 25, ...(more ? { cursor: more } : {}) } });
      setRows((prev) => (more ? [...prev, ...data.feedback] : data.feedback));
      setCursor(data.nextCursor);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not load feedback.');
    } finally {
      setLoading(false);
    }
  }, [apiParams]);

  useEffect(() => { load(null); }, [load, query]);
  useEffect(() => {
    api.get('/canteens').then((r) => setCanteens(r.data.canteens || [])).catch(() => {});
    setMeId(localStorage.getItem('user_id') || '');
  }, []);

  function applyView(params: Record<string, string>) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    router.replace(`/admin/feedback${next.toString() ? `?${next}` : ''}`);
  }

  const activeView = VIEWS.find((v) => v.key !== 'all' && Object.entries(v.params).every(([k, val]) => sp.get(k) === val))?.key
    ?? (FILTER_KEYS.every((k) => !sp.get(k)) ? 'all' : '');

  const sel = 'border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white';

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50 min-w-0">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Feedback</h1>

        <div className="flex flex-wrap gap-2 mb-4">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => applyView(v.params)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${activeView === v.key ? 'bg-[#e94560] text-white border-[#e94560]' : 'bg-white text-gray-700 border-gray-300'}`}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-4 bg-white rounded-xl shadow-sm p-4">
          <select aria-label="Kind" className={sel} value={sp.get('kind') || ''} onChange={(e) => setParam({ kind: e.target.value })}>
            <option value="">All kinds</option>{KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
          <select aria-label="Canteen" className={sel} value={sp.get('canteenId') || ''} onChange={(e) => setParam({ canteenId: e.target.value })}>
            <option value="">All canteens</option>{canteens.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Status" className={sel} value={sp.get('status') || ''} onChange={(e) => setParam({ status: e.target.value })}>
            <option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select aria-label="Priority" className={sel} value={sp.get('priority') || ''} onChange={(e) => setParam({ priority: e.target.value })}>
            <option value="">Any priority</option>{PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select aria-label="Minimum rating" className={sel} value={sp.get('minRating') || ''} onChange={(e) => setParam({ minRating: e.target.value })}>
            <option value="">Min rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}★ and up</option>)}
          </select>
          <select aria-label="Maximum rating" className={sel} value={sp.get('maxRating') || ''} onChange={(e) => setParam({ maxRating: e.target.value })}>
            <option value="">Max rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>up to {n}★</option>)}
          </select>
          <input aria-label="Tag" placeholder="Tag" className={`${sel} w-28`} value={sp.get('tag') || ''} onChange={(e) => setParam({ tag: e.target.value.trim() })} />
          <label className="text-xs text-gray-500">From (IST)
            <input type="date" className={`${sel} block`} value={sp.get('from') || ''} onChange={(e) => setParam({ from: e.target.value })} />
          </label>
          <label className="text-xs text-gray-500">To (IST)
            <input type="date" className={`${sel} block`} value={sp.get('to') || ''} onChange={(e) => setParam({ to: e.target.value })} />
          </label>
          {(['hasPhoto', 'anonymous', 'flagged'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-sm text-gray-700">
              <input type="checkbox" checked={sp.get(k) === 'true'} onChange={(e) => setParam({ [k]: e.target.checked ? 'true' : null })} />
              {k === 'hasPhoto' ? 'Has photo' : label(k)}
            </label>
          ))}
          <button className="text-sm text-gray-500 underline ml-auto" onClick={() => router.replace('/admin/feedback')}>Clear</button>
        </div>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                {['Age', 'Kind', 'Canteen', 'Rating', 'Tags', 'Feedback', 'Status', 'Assignee', 'Priority'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setSelected(r.id)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span title={r.slaDueAt ? `SLA due ${new Date(r.slaDueAt).toLocaleString()}` : ''} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ageClass(r)}`}>{ageLabel(r.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{label(r.kind)}{r.flagged && <span title="Flagged" className="ml-1">🚩</span>}</td>
                  <td className="px-4 py-3">{r.canteen?.name || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.overallRating ? `${r.overallRating}★` : '—'}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{r.tags.map((t: string) => <span key={t} className="px-1.5 py-0.5 rounded bg-gray-100 text-xs">{t}</span>)}</div></td>
                  <td className="px-4 py-3 max-w-xs truncate text-gray-700">{r.snippet || <span className="text-gray-400">No text</span>}{r.photoCount > 0 && ' 📷'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{label(r.status)}</span></td>
                  <td className="px-4 py-3">{r.assigneeName || <span className="text-gray-400">—</span>}</td>
                  <td className={`px-4 py-3 ${PRIORITY_STYLE[r.priority]}`}>{label(r.priority)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="p-6 text-center text-gray-400">Loading...</div>}
          {!loading && rows.length === 0 && <div className="p-8 text-center text-gray-400">No feedback matches these filters</div>}
        </div>
        {cursor && !loading && (
          <button onClick={() => load(cursor)} className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 bg-white">Load more</button>
        )}
      </main>

      {selected && (
        <Drawer id={selected} meId={meId} onClose={() => setSelected(null)}
          onChanged={(row) => setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)))} />
      )}
    </div>
  );
}

function Drawer({ id, meId, onClose, onChanged }: { id: string; meId: string; onClose: () => void; onChanged: (row: any) => void }) {
  const [fb, setFb] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [dupOf, setDupOf] = useState('');
  const [helpfulMsg, setHelpfulMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Opening an item moves RECEIVED to SEEN on the server.
      const { data } = await api.get(`/admin/feedback/${id}`);
      setFb(data.feedback);
      setStatus('');
      onChanged({ id, status: data.feedback.status, priority: data.feedback.priority, assignedTo: data.feedback.assignee?.id ?? null, assigneeName: data.feedback.assignee?.name ?? null });
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not load this item.');
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setFb(null); load(); }, [load]);

  async function run(fn: () => Promise<any>, ok?: () => void) {
    setBusy(true); setError('');
    try { await fn(); ok?.(); await load(); }
    catch (e: any) {
      setError(e?.response?.data?.error || 'Something went wrong.');
      if (e?.response?.status === 409) await load(); // stale: show what the other admin did
    } finally { setBusy(false); }
  }

  const patch = (body: Record<string, unknown>, ok?: () => void) =>
    run(() => api.patch(`/admin/feedback/${id}`, { ...body, expectedStatus: fb.status }), ok);

  const needsReason = status === 'WONT_FIX' || status === 'DUPLICATE';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Feedback detail">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-xl p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 text-xl" aria-label="Close">✕</button>
        {!fb && !error && <p className="text-gray-400">Loading...</p>}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {fb && (
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[fb.status]}`}>{label(fb.status)}</span>
                <span className="text-sm text-gray-500">{label(fb.kind)}</span>
                {fb.overallRating && <span className="text-sm">{fb.overallRating}★</span>}
                {fb.moderation === 'FLAGGED' && <span className="text-xs text-red-600">🚩 flagged</span>}
              </div>
              <p className="text-xs text-gray-500">
                {fb.canteen?.name || 'No canteen'} · {new Date(fb.createdAt).toLocaleString()} ·{' '}
                {fb.isAnonymous ? 'Anonymous sender' : `${fb.author?.name || 'Unknown'}${fb.author?.email ? ` (${fb.author.email})` : ''}`}
              </p>
              {fb.slaDueAt && !CLOSED.includes(fb.status) && <p className="text-xs text-gray-500 mt-1">SLA due {new Date(fb.slaDueAt).toLocaleString()}</p>}
            </div>

            {fb.tags.length > 0 && <div className="flex flex-wrap gap-1">{fb.tags.map((t: string) => <span key={t} className="px-2 py-0.5 rounded bg-gray-100 text-xs">{t}</span>)}</div>}
            <p className="whitespace-pre-wrap text-gray-800">{fb.body || <span className="text-gray-400">No text</span>}</p>

            {fb.items.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-1">Items</h3>
                <ul className="text-sm space-y-0.5">
                  {fb.items.map((i: any) => (
                    <li key={i.menuItemId}>{i.name || 'Item'}: {i.rating}★
                      {(i.taste || i.portion || i.value) && <span className="text-gray-500"> (taste {i.taste ?? '–'}, portion {i.portion ?? '–'}, value {i.value ?? '–'})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <h3 className="font-semibold text-sm">Status and owner</h3>
              <div className="flex flex-wrap gap-2 items-center">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" aria-label="Change status">
                  <option value="">Change status…</option>
                  {STATUSES.filter((s) => s !== fb.status).map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
                <select value={fb.priority} onChange={(e) => patch({ priority: e.target.value })} disabled={busy} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" aria-label="Priority">
                  {PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
                {fb.assignee?.id === meId ? (
                  <button disabled={busy} onClick={() => patch({ assignedTo: null })} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300">Unassign me</button>
                ) : (
                  <button disabled={busy || !meId} onClick={() => patch({ assignedTo: meId })} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300">Assign to me</button>
                )}
                {fb.assignee && fb.assignee.id !== meId && <span className="text-sm text-gray-500">Assigned: {fb.assignee.name}</span>}
              </div>
              {needsReason && (
                <div className="space-y-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" maxLength={500} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  {status === 'DUPLICATE' && (
                    <input value={dupOf} onChange={(e) => setDupOf(e.target.value.trim())} placeholder="Duplicate of (feedback id, optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  )}
                </div>
              )}
              {status && (
                <button disabled={busy || (needsReason && reason.trim().length < 3)}
                  onClick={() => patch({ status, ...(reason ? { reason } : {}), ...(status === 'DUPLICATE' && dupOf ? { duplicateOfId: dupOf } : {}) }, () => { setReason(''); setDupOf(''); })}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#e94560] text-white disabled:opacity-40">
                  Set to {label(status)}
                </button>
              )}
            </div>

            <div className="border-t pt-4 flex flex-wrap gap-2">
              <Link href={`/admin/changelog?link=${id}`} className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300">Publish to changelog</Link>
              {(
                <button disabled={busy} onClick={() => run(async () => { const r = await api.patch(`/admin/feedback/${id}`, { helpful: true }); setHelpfulMsg(r.data.helpfulAwarded ? '+10 points sent' : 'Already marked helpful'); })}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 disabled:opacity-40">Mark helpful (+10 pts)</button>
              )}
              {helpfulMsg && <span className="text-sm text-green-700 self-center">{helpfulMsg}</span>}
            </div>

            <div className="border-t pt-4 space-y-2">
              <h3 className="font-semibold text-sm">Public reply <span className="font-normal text-gray-500">(the student is notified)</span></h3>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Write a reply the student will see" />
              <button disabled={busy || !reply.trim()} onClick={() => run(() => api.post(`/admin/feedback/${id}/reply`, { text: reply }), () => setReply(''))}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#e94560] text-white disabled:opacity-40">Send reply</button>
            </div>

            <div className="border-t pt-4 space-y-2">
              <h3 className="font-semibold text-sm">Internal note <span className="font-normal text-gray-500">(admins only)</span></h3>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Visible to admins only" />
              <button disabled={busy || !note.trim()} onClick={() => run(() => api.post(`/admin/feedback/${id}/notes`, { text: note }), () => setNote(''))}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 disabled:opacity-40">Add note</button>
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-sm mb-2">Timeline</h3>
              <ol className="space-y-2">
                {fb.timeline.map((e: any) => (
                  <li key={e.id} className={`text-sm rounded-lg p-2 ${e.isInternal ? 'bg-yellow-50' : e.type === 'reply' ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <p className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleString()} · {e.type === 'note' ? 'Internal note' : e.type === 'reply' ? 'Public reply' : label(e.type)}</p>
                    {e.type === 'status_changed' && <p>{label(e.fromStatus || '—')} → {label(e.toStatus || '—')}</p>}
                    {e.type === 'priority_changed' && <p>Priority {e.data?.from} → {e.data?.to}</p>}
                    {e.type === 'assigned' && <p>{e.data?.to ? 'Assigned' : 'Unassigned'}</p>}
                    {e.note && <p className="whitespace-pre-wrap">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function FeedbackInboxPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Loading...</div>}>
      <InboxInner />
    </Suspense>
  );
}
