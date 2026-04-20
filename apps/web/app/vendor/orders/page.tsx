'use client';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

interface Order {
  id: string; orderNumber: string; status: string; totalAmount: number; createdAt: string;
  specialInstructions?: string;
  user: { name: string; phone?: string };
  items: { quantity: number; menuItem: { name: string }; notes?: string }[];
  slot: { startTime: string; endTime: string } | null;
}

const STATUSES = ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'];
const statusColors: Record<string, string> = {
  CONFIRMED: 'border-yellow-400 bg-yellow-50',
  ACCEPTED:  'border-blue-400 bg-blue-50',
  PREPARING: 'border-orange-400 bg-orange-50',
  READY:     'border-green-400 bg-green-50',
  PICKED_UP: 'border-gray-300 bg-gray-50',
};
const nextAction: Record<string, { label: string; next: string }> = {
  ACCEPTED:  { label: '🍳 Start Preparing', next: 'PREPARING' },
  PREPARING: { label: '✅ Mark Ready',       next: 'READY' },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const params = new URLSearchParams({ date });
    if (selectedStatus) params.set('status', selectedStatus);
    const { data } = await api.get(`/orders/vendor/list?${params}`);
    setOrders(data.orders || []);
  }, [date, selectedStatus]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: string) {
    await api.patch(`/orders/vendor/${id}/status`, { status });
    load();
  }

  async function respond(id: string, action: 'ACCEPT' | 'REJECT') {
    if (action === 'REJECT') {
      const reason = window.prompt('Reason for rejection (optional):') ?? '';
      await api.patch(`/orders/vendor/${id}/respond`, { action: 'REJECT', rejectReason: reason });
    } else {
      await api.patch(`/orders/vendor/${id}/respond`, { action: 'ACCEPT' });
    }
    load();
  }

  const grouped = orders.reduce((acc, o) => {
    const key = o.slot ? `${o.slot.startTime}–${o.slot.endTime}` : 'Walk-in / Anytime';
    acc[key] = acc[key] || [];
    acc[key].push(o);
    return acc;
  }, {} as Record<string, Order[]>);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Orders</h1>
          <div className="flex gap-3">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="">All Status</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={load} className="border border-gray-300 rounded-lg px-3 py-2 text-sm hover:bg-white transition">
              ↻ Refresh
            </button>
          </div>
        </div>

        {Object.entries(grouped).length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center text-gray-400 shadow-sm">No orders found</div>
        ) : (
          Object.entries(grouped).map(([slot, slotOrders]) => (
            <div key={slot} className="mb-6">
              <h2 className="font-semibold text-gray-600 mb-3 flex items-center gap-2">
                <span className="bg-[#1a1a2e] text-white text-xs px-2 py-1 rounded">{slot}</span>
                <span className="text-sm text-gray-400">{slotOrders.length} order{slotOrders.length !== 1 ? 's' : ''}</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {slotOrders.map((order) => (
                  <div key={order.id} className={`bg-white rounded-xl border-l-4 p-4 shadow-sm ${statusColors[order.status] || ''}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold text-sm">{order.orderNumber}</p>
                        <p className="text-xs text-gray-500">{order.user?.name}</p>
                        <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleTimeString()}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold">₹{Number(order.totalAmount).toFixed(0)}</span>
                        <p className="text-xs text-gray-400">💰 Wallet</p>
                      </div>
                    </div>
                    <ul className="text-xs text-gray-600 mb-3 space-y-0.5">
                      {order.items?.map((item, i) => (
                        <li key={i}>• {item.menuItem.name} ×{item.quantity}{item.notes ? ` (${item.notes})` : ''}</li>
                      ))}
                    </ul>
                    {order.specialInstructions && (
                      <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded mb-2">
                        📝 {order.specialInstructions}
                      </p>
                    )}

                    {/* CONFIRMED: show Accept / Reject */}
                    {order.status === 'CONFIRMED' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => respond(order.id, 'ACCEPT')}
                          className="flex-1 text-xs bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition">
                          ✅ Accept
                        </button>
                        <button
                          onClick={() => respond(order.id, 'REJECT')}
                          className="flex-1 text-xs bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 transition">
                          ❌ Reject
                        </button>
                      </div>
                    )}

                    {/* ACCEPTED / PREPARING: advance status */}
                    {nextAction[order.status] && (
                      <button
                        onClick={() => updateStatus(order.id, nextAction[order.status].next)}
                        className="w-full text-xs bg-[#1a1a2e] text-white py-2 rounded-lg hover:bg-[#e94560] transition">
                        {nextAction[order.status].label}
                      </button>
                    )}

                    {order.status === 'READY' && (
                      <p className="text-center text-xs text-green-600 font-medium">✅ Ready for pickup — scan QR</p>
                    )}
                    {order.status === 'PICKED_UP' && (
                      <p className="text-center text-xs text-gray-500 font-medium">✓ Collected</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
