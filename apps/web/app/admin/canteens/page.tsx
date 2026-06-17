'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

export default function CanteensPage() {
  const [canteens, setCanteens] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/canteens?includeInactive=true').then(r => setCanteens(r.data.canteens || [])),
      api.get('/admin/vendors').then(r => setVendors(r.data.vendors || [])),
    ]).catch(console.error);
  }, []);

  async function toggleActive(id: string, current: boolean) {
    if (current) {
      await api.delete(`/canteens/${id}`);
    } else {
      await api.put(`/canteens/${id}`, { isActive: true });
    }
    const { data } = await api.get('/canteens?includeInactive=true');
    setCanteens(data.canteens || []);
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Canteen Management</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {canteens.map((c) => (
            <div key={c.id} className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h2 className="font-semibold text-lg">{c.name}</h2>
                  <p className="text-sm text-gray-500">{c.campus} • {c.location}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-3">{c.description}</p>
              <div className="flex gap-2 text-xs text-gray-500 mb-3">
                <span>⏰ {c.openingTime}–{c.closingTime}</span>
                <span>• Avg prep: {c.avgPrepTime} min</span>
              </div>
              <div className="text-sm text-gray-600 border-t pt-3">
                <span className="font-medium">Vendor: </span>
                {c.vendor ? c.vendor.name : <span className="text-amber-600">Unassigned</span>}
              </div>
              <button onClick={() => toggleActive(c.id, c.isActive)}
                className={`mt-3 w-full text-sm py-2 rounded-lg ${c.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'} transition`}>
                {c.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
