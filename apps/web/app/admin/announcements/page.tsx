'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', body: '', startsAt: '', endsAt: '' });
  const [showForm, setShowForm] = useState(false);

  const load = () => api.get('/admin/announcements').then(r => setAnnouncements(r.data.announcements || []));

  useEffect(() => { load(); }, []);

  async function create() {
    await api.post('/admin/announcements', {
      ...form,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
    });
    setShowForm(false);
    setForm({ title: '', body: '', startsAt: '', endsAt: '' });
    load();
  }

  async function toggle(id: string) {
    await api.patch(`/admin/announcements/${id}/toggle`);
    load();
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Announcements</h1>
          <button onClick={() => setShowForm(!showForm)} className="bg-[#e94560] text-white px-4 py-2 rounded-lg text-sm font-medium">
            + New Announcement
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <h2 className="font-semibold mb-4">Create Announcement</h2>
            <div className="space-y-3">
              <input placeholder="Title" value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
              <textarea placeholder="Message body" value={form.body} onChange={e => setForm({...form, body: e.target.value})}
                className="w-full border rounded-lg px-3 py-2 text-sm h-24 resize-none" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Starts At</label>
                  <input type="datetime-local" value={form.startsAt} onChange={e => setForm({...form, startsAt: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Ends At (optional)</label>
                  <input type="datetime-local" value={form.endsAt} onChange={e => setForm({...form, endsAt: e.target.value})}
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={create} className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm">Publish</button>
                <button onClick={() => setShowForm(false)} className="text-gray-500 text-sm">Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {announcements.map(a => (
            <div key={a.id} className="bg-white rounded-xl shadow-sm p-5 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{a.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${a.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {a.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{a.body}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(a.startsAt).toLocaleString()} {a.endsAt ? `→ ${new Date(a.endsAt).toLocaleString()}` : ''}
                </p>
              </div>
              <button onClick={() => toggle(a.id)}
                className={`ml-4 text-sm px-3 py-1 rounded-lg ${a.isActive ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                {a.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
