import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Html5Qrcode } from 'html5-qrcode';
import './App.css';

const API = 'http://localhost:8000';

const STATUS_CONFIG = {
  CONFIRMED:  { label: 'New Order',  color: '#f59e0b', bg: '#fef3c7', next: 'ACCEPTED',  btnLabel: '✓ Accept Order',    btnColor: '#f59e0b' },
  ACCEPTED:   { label: 'Accepted',   color: '#3b82f6', bg: '#dbeafe', next: 'PREPARING', btnLabel: '🍳 Start Preparing', btnColor: '#3b82f6' },
  PREPARING:  { label: 'Preparing',  color: '#8b5cf6', bg: '#ede9fe', next: 'READY',     btnLabel: '✓ Mark Ready',      btnColor: '#10b981' },
  READY:      { label: 'Ready!',     color: '#10b981', bg: '#dcfce7', next: null,         btnLabel: '📷 Scan QR',        btnColor: '#e94560' },
  PICKED_UP:  { label: 'Picked Up', color: '#6b7280', bg: '#f3f4f6', next: null,         btnLabel: null,               btnColor: null },
};

export default function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(new Set());
  const [scanningOrderId, setScanningOrderId] = useState(null);
  const [scanError, setScanError] = useState('');
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  useEffect(() => {
    fetchOrders();
    const iv = setInterval(fetchOrders, 3000);
    return () => clearInterval(iv);
  }, []);

  // Start/stop QR scanner when scanningOrderId changes
  useEffect(() => {
    if (scanningOrderId) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [scanningOrderId]);

  async function fetchOrders() {
    try {
      const { data } = await axios.get(`${API}/queue`);
      setOrders(data);
      setError(null);
      setLoading(false);
    } catch {
      setError('Cannot reach backend. Is it running on port 8000?');
      setLoading(false);
    }
  }

  async function advanceStatus(orderId, nextStatus) {
    setBusy(prev => new Set([...prev, orderId]));
    try {
      await axios.post(`${API}/update_status/${orderId}?status=${nextStatus}`);
      await fetchOrders();
    } catch {
      alert('Failed to update status. Try again.');
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(orderId); return s; });
    }
  }

  function startScanner() {
    setScanError('');
    setTimeout(() => {
      if (!scannerRef.current) return;
      html5QrRef.current = new Html5Qrcode('qr-reader');
      html5QrRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          await stopScanner();
          await verifyQR(decodedText);
        },
        () => {}
      ).catch(() => setScanError('Camera access denied. Allow camera permission.'));
    }, 200);
  }

  async function stopScanner() {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
    }
  }

  async function verifyQR(token) {
    const order = orders.find(o => o.id === scanningOrderId);
    setScanningOrderId(null);
    if (!order) return;

    if (order.token === token) {
      await axios.post(`${API}/pickup?order_id=${order.id}&token=${token}`).catch(() => {});
      await fetchOrders();
      alert(`✅ Order ${order.orderNumber || order.id.slice(-4).toUpperCase()} verified! Customer can collect.`);
    } else {
      alert('❌ Invalid QR code. Token does not match.');
    }
  }

  function handleAction(order) {
    const cfg = STATUS_CONFIG[order.status];
    if (!cfg) return;
    if (order.status === 'READY') {
      setScanningOrderId(order.id);
    } else if (cfg.next) {
      advanceStatus(order.id, cfg.next);
    }
  }

  const activeOrders = orders.filter(o => o.status !== 'PICKED_UP');
  const doneOrders = orders.filter(o => o.status === 'PICKED_UP');

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'sans-serif' }}>

      {/* Header */}
      <header style={{ background: '#1e293b', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #334155' }}>
        <div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 800, margin: 0 }}>🍽️ ChristEats — Kitchen Display</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '2px 0 0' }}>Christ University Main Block</p>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Stat label="Active" value={activeOrders.length} color="#f59e0b" />
          <Stat label="Ready" value={orders.filter(o => o.status === 'READY').length} color="#10b981" />
          <Stat label="Done" value={doneOrders.length} color="#6b7280" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
            <span style={{ color: '#10b981', fontSize: 12, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
      </header>

      {/* Pipeline header */}
      <div style={{ background: '#1e293b', padding: '10px 24px', display: 'flex', gap: 8 }}>
        {['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY'].map(s => {
          const cnt = orders.filter(o => o.status === s).length;
          const cfg = STATUS_CONFIG[s];
          return (
            <div key={s} style={{ background: cfg.bg, borderRadius: 8, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, color: cfg.color, fontSize: 13 }}>{cfg.label}</span>
              <span style={{ background: cfg.color, color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 12, fontWeight: 800 }}>{cnt}</span>
            </div>
          );
        })}
      </div>

      <main style={{ padding: 24 }}>
        {loading && <CenterMessage icon="⏳" text="Loading orders..." />}
        {error && <CenterMessage icon="⚠️" text={error} />}
        {!loading && !error && activeOrders.length === 0 && <CenterMessage icon="✨" text="No active orders. Waiting..." />}

        {/* Active Orders Grid */}
        {!loading && !error && activeOrders.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {activeOrders.map(order => <OrderCard key={order.id} order={order} busy={busy} onAction={handleAction} />)}
          </div>
        )}

        {/* Completed Orders */}
        {doneOrders.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ color: '#94a3b8', fontSize: 14, fontWeight: 700, marginBottom: 12, letterSpacing: 1 }}>COMPLETED</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {doneOrders.map(order => <OrderCard key={order.id} order={order} busy={busy} onAction={handleAction} />)}
            </div>
          </div>
        )}
      </main>

      {/* QR Scanner Modal */}
      {scanningOrderId && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000cc', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1e293b', borderRadius: 20, padding: 24, width: 340, textAlign: 'center' }}>
            <h2 style={{ color: '#fff', marginBottom: 4 }}>Scan Customer QR</h2>
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Point camera at customer's QR code</p>
            <div id="qr-reader" ref={scannerRef} style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 12 }} />
            {scanError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{scanError}</p>}
            <button
              onClick={() => setScanningOrderId(null)}
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 24px', fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}

function OrderCard({ order, busy, onAction }) {
  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG['CONFIRMED'];
  const isBusy = busy.has(order.id);
  const orderNum = order.orderNumber || `#${order.id.slice(-4).toUpperCase()}`;
  const elapsed = order.createdAt ? Math.floor((Date.now() - new Date(order.createdAt)) / 60000) : null;

  return (
    <div style={{ background: '#1e293b', borderRadius: 16, overflow: 'hidden', border: `2px solid ${cfg.color}30` }}>
      {/* Status bar */}
      <div style={{ background: cfg.bg, padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: cfg.color, fontWeight: 800, fontSize: 13 }}>{cfg.label}</span>
        {elapsed !== null && <span style={{ color: cfg.color, fontSize: 12 }}>⏱ {elapsed}m ago</span>}
      </div>

      <div style={{ padding: 16 }}>
        {/* Order number & customer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>{orderNum}</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>👤 {order.customer_name || 'Student'}</span>
        </div>

        {/* Items */}
        <div style={{ marginBottom: 12 }}>
          {(order.items || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: '#0f172a', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{item.name}</span>
              <span style={{ background: cfg.color, color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 700 }}>×{item.qty}</span>
            </div>
          ))}
        </div>

        {/* ETA & amount */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>⏱ ETA: {order.eta_minutes ? `${order.eta_minutes} min` : '—'}</span>
          {order.totalAmount && <span style={{ color: '#94a3b8', fontSize: 12 }}>₹{order.totalAmount}</span>}
        </div>

        {/* Action button */}
        {cfg.btnLabel && order.status !== 'PICKED_UP' && (
          <button
            onClick={() => onAction(order)}
            disabled={isBusy}
            style={{ background: isBusy ? '#334155' : cfg.btnColor, color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: 14, cursor: isBusy ? 'not-allowed' : 'pointer', width: '100%', transition: 'opacity .2s' }}>
            {isBusy ? 'Updating...' : cfg.btnLabel}
          </button>
        )}
        {order.status === 'PICKED_UP' && (
          <div style={{ background: '#0f172a', borderRadius: 10, padding: 12, textAlign: 'center', color: '#10b981', fontWeight: 700 }}>
            ✅ Collected
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color, fontSize: 22, fontWeight: 800 }}>{value}</div>
      <div style={{ color: '#94a3b8', fontSize: 11 }}>{label}</div>
    </div>
  );
}

function CenterMessage({ icon, text }) {
  return (
    <div style={{ textAlign: 'center', padding: 80 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <p style={{ color: '#94a3b8', fontSize: 16 }}>{text}</p>
    </div>
  );
}
