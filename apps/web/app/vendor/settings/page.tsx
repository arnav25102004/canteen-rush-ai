'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

interface CanteenSettings {
  name: string;
  description: string;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
}

export default function VendorSettingsPage() {
  const [settings, setSettings] = useState<CanteenSettings>({
    name: '', description: '', openTime: '08:00', closeTime: '20:00', isOpen: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/canteens/my')
      .then(({ data }) => setSettings({
        name: data.canteen.name || '',
        description: data.canteen.description || '',
        openTime: data.canteen.openTime || '08:00',
        closeTime: data.canteen.closeTime || '20:00',
        isOpen: data.canteen.isOpen ?? true,
      }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api.put('/canteens/my', settings);
      setMessage('Settings saved successfully.');
    } catch {
      setMessage('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Canteen Settings</h1>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : (
          <form onSubmit={handleSave} className="max-w-lg space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Canteen Name</label>
              <input
                type="text"
                value={settings.name}
                onChange={e => setSettings(s => ({ ...s, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={settings.description}
                onChange={e => setSettings(s => ({ ...s, description: e.target.value }))}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Open Time</label>
                <input
                  type="time"
                  value={settings.openTime}
                  onChange={e => setSettings(s => ({ ...s, openTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Close Time</label>
                <input
                  type="time"
                  value={settings.closeTime}
                  onChange={e => setSettings(s => ({ ...s, closeTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isOpen"
                checked={settings.isOpen}
                onChange={e => setSettings(s => ({ ...s, isOpen: e.target.checked }))}
                className="w-4 h-4 accent-blue-600"
              />
              <label htmlFor="isOpen" className="text-sm font-medium text-gray-700">Canteen is currently open</label>
            </div>
            {message && (
              <p className={`text-sm ${message.includes('success') ? 'text-green-600' : 'text-red-500'}`}>
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
