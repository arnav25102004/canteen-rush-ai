'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';
import { auth } from '../../../lib/firebase';
import { io, Socket } from 'socket.io-client';

interface OrderItem { quantity: number; menuItem: { name: string } }
interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalAmount: number;
  pickupCode?: string;
  createdAt: string;
  user: { name: string };
  items: OrderItem[];
  slot: { startTime: string; endTime: string } | null;
}
interface Stats { totalOrders: number; totalRevenue: number; avgPrepTimeMinutes: number }

// What the single action button does per status
const ACTION: Record<string, { label: string; next: string; color: string }> = {
  CONFIRMED: { label: 'Accept & Start', next: 'PREPARING', color: '#f59e0b' },
  ACCEPTED:  { label: 'Mark Preparing', next: 'PREPARING', color: '#f59e0b' },
  PREPARING: { label: '✓ Ready for Pickup', next: 'READY',    color: '#10b981' },
};

const STATUS_STYLE: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  CONFIRMED: { bg: '#fef9c3', text: '#854d0e', dot: '#eab308', label: 'New Order'  },
  ACCEPTED:  { bg: '#dbeafe', text: '#1e3a8a', dot: '#3b82f6', label: 'Accepted'   },
  PREPARING: { bg: '#ffedd5', text: '#7c2d12', dot: '#f97316', label: 'Preparing'  },
  READY:     { bg: '#dcfce7', text: '#14532d', dot: '#22c55e', label: 'Ready!'     },
  PENDING:   { bg: '#f3e8ff', text: '#581c87', dot: '#a855f7', label: 'Pending'    },
};

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} mins ago`;
}

export default function VendorDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const loadingRef = useRef(false);

  const loadData = useCallback(async () => {
    if (loadingRef.current) return; // debounce — skip if already fetching
    loadingRef.current = true;
    try {
      const [statsRes, ordersRes] = await Promise.all([
        api.get('/analytics/vendor/summary?period=today').catch(() => ({ data: null })),
        api.get('/orders/vendor/list').catch(() => ({ data: { orders: [] } })),
      ]);
      if (statsRes.data) setStats(statsRes.data);
      if (ordersRes.data.orders) setOrders(ordersRes.data.orders.slice(0, 40));
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadData();
    const canteenId = localStorage.getItem('canteen_id');
    if (!canteenId) return;

    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://canteen-rush-ai.onrender.com', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      // Fetched per (re)connect: the server rejects unauthenticated handshakes
      // and only lets the assigned vendor join this canteen's room.
      auth: (cb) => {
        const user = auth.currentUser;
        if (!user) return cb({ token: null });
        user.getIdToken(false)
          .then((token) => cb({ token }))
          .catch(() => cb({ token: null }));
      },
    });
    s.emit('join:canteen', { canteenId });
    s.on('order:new', () => loadData());
    s.on('order:status_update', () => loadData());
    setSocket(s);
    return () => { s.disconnect(); };
  }, [loadData]);

  async function markStatus(orderId: string, next: string) {
    await api.patch(`/orders/vendor/${orderId}/status`, { status: next });
    // Optimistic update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: next } : o));
  }

  // Group by status for column layout
  const active  = orders.filter(o => ['CONFIRMED', 'ACCEPTED', 'PREPARING'].includes(o.status));
  const ready   = orders.filter(o => o.status === 'READY');
  const pending = orders.filter(o => o.status === 'PENDING');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ color: '#f1f5f9', fontSize: 26, fontWeight: 800, margin: 0 }}>Kitchen Display</h1>
            <p style={{ color: '#64748b', fontSize: 13, margin: '4px 0 0' }}>
              {active.length + ready.length} active · {pending.length} awaiting payment
            </p>
          </div>
          <button
            onClick={loadData}
            style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 10, padding: '8px 18px', cursor: 'pointer', fontSize: 13 }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Orders Today', value: stats?.totalOrders ?? '—', icon: '📋' },
            { label: 'Revenue',      value: stats?.totalRevenue ? `₹${stats.totalRevenue}` : '—', icon: '💰' },
            { label: 'Avg Prep',     value: stats?.avgPrepTimeMinutes ? `${stats.avgPrepTimeMinutes} min` : '—', icon: '⏱' },
          ].map(s => (
            <div key={s.label} style={{ background: '#1e293b', borderRadius: 14, padding: '20px 24px', border: '1px solid #334155' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ color: '#f1f5f9', fontSize: 24, fontWeight: 800 }}>{s.value}</div>
              <div style={{ color: '#64748b', fontSize: 13 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Order Cards Grid */}
        {active.length === 0 && ready.length === 0 && pending.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#475569', marginTop: 80, fontSize: 18 }}>
            No active orders right now
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
            {[...pending, ...active, ...ready].map(order => {
              const style = STATUS_STYLE[order.status] || STATUS_STYLE.CONFIRMED;
              const action = ACTION[order.status];
              return (
                <div
                  key={order.id}
                  style={{
                    background: '#1e293b',
                    borderRadius: 18,
                    border: `2px solid ${style.dot}40`,
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: order.status === 'READY' ? `0 0 24px ${style.dot}50` : 'none',
                  }}
                >
                  {/* Top row — status badge + time */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                      background: style.bg,
                      color: style.text,
                      borderRadius: 20,
                      padding: '4px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: style.dot, display: 'inline-block' }} />
                      {style.label}
                    </span>
                    <span style={{ color: '#64748b', fontSize: 12 }}>{timeAgo(order.createdAt)}</span>
                  </div>

                  {/* Order number + customer */}
                  <div>
                    <div style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>
                      {order.pickupCode ?? order.orderNumber}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 2 }}>{order.user?.name}</div>
                  </div>

                  {/* Items */}
                  <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {order.items?.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#cbd5e1', fontSize: 14 }}>{item.menuItem.name}</span>
                        <span style={{ color: '#64748b', fontSize: 14, fontWeight: 600 }}>×{item.quantity}</span>
                      </div>
                    ))}
                  </div>

                  {/* Slot + payment */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#64748b', fontSize: 12 }}>
                      {order.slot ? `⏰ ${order.slot.startTime}–${order.slot.endTime}` : 'Walk-in'}
                    </span>
                    {order.paymentMethod === 'CASH' ? (
                      <span style={{ background: '#fef9c3', color: '#854d0e', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                        💵 Collect Cash
                      </span>
                    ) : order.paymentStatus === 'PAID' ? (
                      <span style={{ background: '#dcfce7', color: '#14532d', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>
                        ✅ Paid
                      </span>
                    ) : null}
                  </div>

                  {/* Amount */}
                  <div style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 800 }}>
                    ₹{Number(order.totalAmount).toFixed(0)}
                  </div>

                  {/* Single action button */}
                  {action && (
                    <button
                      onClick={() => markStatus(order.id, action.next)}
                      style={{
                        background: action.color,
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        padding: '14px',
                        fontSize: 15,
                        fontWeight: 700,
                        cursor: 'pointer',
                        width: '100%',
                        letterSpacing: 0.3,
                      }}
                    >
                      {action.label}
                    </button>
                  )}

                  {/* Ready state — just a glow, no button needed */}
                  {order.status === 'READY' && (
                    <div style={{ textAlign: 'center', color: '#22c55e', fontSize: 14, fontWeight: 700, padding: '8px 0' }}>
                      ✓ Waiting for student pickup
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
