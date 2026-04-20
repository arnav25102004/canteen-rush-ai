'use client';
import { useEffect, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

export default function VendorsPage() {
  const [vendors, setVendors] = useState<any[]>([]);
  const [canteens, setCanteens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/admin/vendors').then(r => setVendors(r.data.vendors || [])),
      api.get('/canteens').then(r => setCanteens(r.data.canteens || [])),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Vendor Management</h1>

        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b">
            <p className="text-sm text-gray-500">{vendors.length} vendors registered</p>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading...</div>
          ) : vendors.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No vendors found</div>
          ) : (
            <div className="divide-y">
              {vendors.map((v: any) => {
                const assignedCanteen = canteens.find((c: any) => c.vendorId === v.id);
                return (
                  <div key={v.id} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">
                        {v.name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">{v.name}</p>
                        <p className="text-sm text-gray-500">{v.email}</p>
                        {assignedCanteen && (
                          <p className="text-xs text-indigo-600 mt-0.5">🏪 {assignedCanteen.name}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-gray-400">
                        Joined {new Date(v.createdAt).toLocaleDateString()}
                      </span>
                      {v.vendorCanteen ? (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">Assigned</span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">Unassigned</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
