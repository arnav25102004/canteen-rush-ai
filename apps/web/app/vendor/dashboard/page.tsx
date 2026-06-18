'use client';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';
import { io, Socket } from 'socket.io-client';

interface Order {
  id: string; orderNumber: string; status: string; totalAmount: number;
  paymentStatus: string; upiOrderNote?: string;
  createdAt: string;
  user: { name: string };
  items: { quantity: number; menuItem: { name: string } }[];
  slot: { startTime: string; endTime: string } | null;
}

interface Stats { totalOrders: number; totalRevenue: number; avgPrepTimeMinutes: number }

export default function VendorDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [liveOrders, setLiveOrders] = useState<Order[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  const loadData = useCallback(async () => {
    const [statsRes, ordersRes] = await Promise.all([
      api.get('/analytics/vendor/summary?period=today').catch(() => ({ data: null })),
      api.get('/orders/vendor/list').catch(() => ({ data: { orders: [] } })),
    ]);
    if (statsRes.data) setStats(statsRes.data);
    if (ordersRes.data.orders) setLiveOrders(ordersRes.data.orders.slice(0, 10));
  }, []);

  useEffect(() => {
    loadData();

    const canteenId = localStorage.getItem('canteen_id');
    if (canteenId) {
      const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://canteen-rush-ai.onrender.com', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      });
      s.emit('join:canteen', { canteenId });
      s.on('order:new', ({ order }: { order: Order }) => {
        setLiveOrders((prev) => [order, ...prev].slice(0, 10));
      });
      s.on('order:status_update', () => loadData());
      setSocket(s);
      return () => { s.disconnect(); };
    }
  }, [loadData]);

  async function markStatus(orderId: string, status: string) {
    await api.patch(`/orders/vendor/${orderId}/status`, { status });
    loadData();
  }

  async function verifyPayment(orderId: string, confirmed: boolean) {
    await api.patch(`/orders/vendor/${orderId}/verify-payment`, { confirmed });
    loadData();
  }

  const statusColor: Record<string, string> = {
    CONFIRMED: 'bg-yellow-100 text-yellow-800',
    ACCEPTED: 'bg-blue-100 text-blue-800',
    PREPARING: 'bg-orange-100 text-orange-800',
    READY: 'bg-green-100 text-green-800',
    PICKED_UP: 'bg-gray-100 text-gray-600',
  };

  const nextAction: Record<string, { label: string; next: string; color: string }> = {
    CONFIRMED: { label: 'Accept', next: 'ACCEPTED', color: 'bg-blue-500' },
    ACCEPTED: { label: 'Start Preparing', next: 'PREPARING', color: 'bg-orange-500' },
    PREPARING: { label: 'Mark Ready', next: 'READY', color: 'bg-green-500' },
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Today's Dashboard</h1>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Orders', value: stats?.totalOrders ?? '—', icon: '📋' },
            { label: 'Revenue', value: stats?.totalRevenue ? `₹${stats.totalRevenue}` : '—', icon: '💰' },
            { label: 'Avg Prep Time', value: stats?.avgPrepTimeMinutes ? `${stats.avgPrepTimeMinutes} min` : '—', icon: '⏱️' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-6 shadow-sm">
              <p className="text-2xl mb-2">{s.icon}</p>
              <p className="text-2xl font-bold text-gray-800">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Live Orders */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="p-6 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Live Orders</h2>
            <button onClick={loadData} className="text-sm text-blue-500 hover:underline">Refresh</button>
          </div>
          <div className="divide-y">
            {liveOrders.length === 0 ? (
              <p className="p-8 text-center text-gray-400">No active orders</p>
            ) : (
              liveOrders.map((order) => (
                <div key={order.id} className="p-4">
                  {/* Payment verification banner */}
                  {order.paymentStatus === 'PENDING_VERIFICATION' && (
                    <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <p className="text-sm font-semibold text-amber-800 mb-1">
                        🟡 Student claims payment sent — ₹{Number(order.totalAmount).toFixed(0)}
                      </p>
                      {order.upiOrderNote && (
                        <p className="text-xs text-amber-700 mb-2">Check GPay for: <strong>{order.upiOrderNote}</strong></p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => verifyPayment(order.id, true)}
                          className="flex-1 text-sm bg-green-500 text-white py-1.5 rounded-lg font-medium hover:bg-green-600"
                        >
                          ✅ Received
                        </button>
                        <button
                          onClick={() => verifyPayment(order.id, false)}
                          className="flex-1 text-sm bg-red-500 text-white py-1.5 rounded-lg font-medium hover:bg-red-600"
                        >
                          ❌ Not Received
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{order.orderNumber}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor[order.status] || 'bg-gray-100'}`}>
                          {order.status}
                        </span>
                        {order.paymentStatus === 'AWAITING_PAYMENT' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">⏳ Awaiting Payment</span>
                        )}
                        {order.paymentStatus === 'VERIFIED' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">✅ Paid</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{order.user?.name} • {order.items?.map(i => `${i.menuItem.name} ×${i.quantity}`).join(', ')}</p>
                      {order.slot && <p className="text-xs text-gray-400">Slot: {order.slot.startTime}–{order.slot.endTime}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">₹{Number(order.totalAmount).toFixed(0)}</p>
                      {nextAction[order.status] && (
                        <button
                          onClick={() => markStatus(order.id, nextAction[order.status].next)}
                          className={`mt-1 text-xs text-white px-3 py-1 rounded-lg ${nextAction[order.status].color}`}
                        >
                          {nextAction[order.status].label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
