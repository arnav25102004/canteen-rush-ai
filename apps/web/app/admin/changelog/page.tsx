'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

const TITLE_MAX = 80;
const BODY_MAX = 500;
const MAX_LINKS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ChangelogInner() {
  const sp = useSearchParams();
  const preLink = sp.get('link');

  const [entries, setEntries] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [canteens, setCanteens] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [canteenId, setCanteenId] = useState('');
  const [markResolved, setMarkResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const loadEntries = useCallback(() => {
    api.get('/admin/changelog').then((r) => setEntries(r.data.entries || [])).catch(() => setError('Could not load the changelog.'));
  }, []);

  useEffect(() => {
    loadEntries();
    api.get('/admin/feedback', { params: { status: 'SEEN,IN_PROGRESS,RESOLVED', limit: 50 } })
      .then((r) => setCandidates(r.data.feedback || [])).catch(() => {});
    api.get('/canteens').then((r) => setCanteens(r.data.canteens || [])).catch(() => {});
  }, [loadEntries]);

  // The drawer's "Publish to changelog" button arrives here with the feedback already linked.
  useEffect(() => {
    if (preLink && UUID.test(preLink)) setSelected((prev) => (prev.includes(preLink) ? prev : [...prev, preLink]));
  }, [preLink]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_LINKS ? [...prev, id] : prev));
  }

  async function publish() {
    setBusy(true); setError(''); setDone('');
    try {
      const { data } = await api.post('/admin/changelog', {
        title: title.trim(), body: body.trim(), linkedFeedbackIds: selected, markResolved,
        ...(canteenId ? { canteenId } : {}),
      });
      setDone(`Published. ${data.notified} student${data.notified === 1 ? '' : 's'} notified.`);
      setTitle(''); setBody(''); setSelected([]); setMarkResolved(false);
      loadEntries();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not publish.');
    } finally { setBusy(false); }
  }

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm';
  const unlisted = selected.filter((id) => !candidates.some((c) => c.id === id));

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50 min-w-0">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">You said, we did</h1>
        <p className="text-sm text-gray-500 mb-6">Tell students what changed because of their feedback. Everyone linked below gets a notification.</p>

        <section className="bg-white rounded-xl shadow-sm p-6 mb-8 space-y-3">
          <h2 className="font-semibold">Publish an update</h2>
          <div>
            <input value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Short headline, for example: Second billing counter added" className={input} aria-label="Title" />
            <p className="text-xs text-gray-400 text-right">{title.length}/{TITLE_MAX}</p>
          </div>
          <div>
            <textarea value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What changed, in a sentence or two" className={input} aria-label="Details" />
            <p className="text-xs text-gray-400 text-right">{body.length}/{BODY_MAX}</p>
          </div>
          <select value={canteenId} onChange={(e) => setCanteenId(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" aria-label="Canteen">
            <option value="">All canteens</option>
            {canteens.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <div>
            <h3 className="text-sm font-semibold mb-1">Linked feedback ({selected.length}/{MAX_LINKS})</h3>
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y">
              {unlisted.map((id) => (
                <label key={id} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-50">
                  <input type="checkbox" checked onChange={() => toggle(id)} /> Linked item {id.slice(0, 8)}
                </label>
              ))}
              {candidates.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100">{c.status.toLowerCase().replace('_', ' ')}</span>
                  <span className="truncate">{c.snippet || c.tags.join(', ') || 'No text'}</span>
                </label>
              ))}
              {candidates.length === 0 && unlisted.length === 0 && <p className="p-3 text-sm text-gray-400">No in-progress or resolved feedback to link.</p>}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={markResolved} onChange={(e) => setMarkResolved(e.target.checked)} />
            Also mark the linked feedback as resolved
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && <p className="text-sm text-green-700">{done}</p>}
          <button disabled={busy || !title.trim() || !body.trim()} onClick={publish}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#e94560] text-white disabled:opacity-40">
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </section>

        <h2 className="font-semibold mb-3">Published</h2>
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className="bg-white rounded-xl shadow-sm p-4">
              <p className="font-semibold text-gray-800">{e.title}</p>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{e.body}</p>
              <p className="text-xs text-gray-400 mt-1">{new Date(e.publishedAt).toLocaleString()} · {e.linkedCount} linked</p>
            </div>
          ))}
          {entries.length === 0 && <p className="text-gray-400 text-sm">Nothing published yet.</p>}
        </div>
      </main>
    </div>
  );
}

export default function ChangelogPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Loading...</div>}>
      <ChangelogInner />
    </Suspense>
  );
}
