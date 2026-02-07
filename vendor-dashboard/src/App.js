import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [completingOrders, setCompletingOrders] = useState(new Set());

  // Fetch orders from API
  const fetchOrders = async () => {
    try {
      // connecting to your Python Backend
      const response = await axios.get('http://localhost:8000/queue');
      setOrders(response.data);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError('Failed to fetch orders. Is the backend running?');
      setLoading(false);
      console.error('Error fetching orders:', err);
    }
  };

  // Mark order as complete (Ready for Pickup)
  const completeOrder = async (orderId) => {
    setCompletingOrders(prev => new Set([...prev, orderId]));

    try {
      // FIXED: Updated to match your new main.py endpoint
      await axios.post(`http://localhost:8000/update_status/${orderId}?status=ready`);

      // Refresh orders after completion
      await fetchOrders();
    } catch (err) {
      console.error('Error completing order:', err);
      alert('Failed to complete order. Please try again.');
    } finally {
      setCompletingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });
    }
  };

  // Poll API every 3 seconds
  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 3000);
    return () => clearInterval(interval);
  }, []);

  // Get status color
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'ordered':
        return 'status-pending'; // Red/Orange
      case 'preparing':
        return 'status-preparing'; // Blue
      case 'ready':
        return 'status-completed'; // Green
      case 'collected':
        return 'status-collected'; // Gray
      default:
        return 'status-pending';
    }
  };

  // Format time display
  const formatTime = (minutes) => {
    if (!minutes) return 'Calculating...';
    return `${minutes} min`;
  };

  // Get current time
  const getCurrentTime = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="App">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1 className="logo">🍔 Canteen Rush AI</h1>
          <span className="subtitle">Kitchen Display System</span>
        </div>
        <div className="header-right">
          <div className="stats">
            <div className="stat-item">
              <span className="stat-label">Active Orders</span>
              <span className="stat-value">{orders.filter(o => o.status !== 'collected').length}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Current Time</span>
              <span className="stat-value">{getCurrentTime()}</span>
            </div>
          </div>
          <div className="status-indicator">
            <span className="pulse"></span>
            <span>LIVE</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {loading && (
          <div className="loading-screen">
            <div className="spinner"></div>
            <p>Loading orders...</p>
          </div>
        )}

        {error && (
          <div className="error-screen">
            <div className="error-icon">⚠️</div>
            <p>{error}</p>
            <button onClick={fetchOrders} className="retry-btn">Retry Connection</button>
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">✨</div>
            <h2>No Active Orders</h2>
            <p>Waiting for new orders to arrive...</p>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <div className="orders-grid">
            {orders.map((order) => (
              <div
                key={order.id}
                className={`order-card ${getStatusColor(order.status)} ${completingOrders.has(order.id) ? 'completing' : ''}`}
              >
                {/* Order Header */}
                <div className="order-header">
                  <div className="order-id">
                    <span className="label">Order</span>
                    <span className="value">#{order.id.slice(-4).toUpperCase()}</span>
                  </div>
                  <div className={`status-badge ${getStatusColor(order.status)}`}>
                    {order.status || 'Ordered'}
                  </div>
                </div>

                {/* Order Details */}
                <div className="order-body">
                  <div className="student-info">
                    <span className="icon">👤</span>
                    <span className="student-id">Student: {order.student_id}</span>
                  </div>

                  {/* FIXED: Loop through items list */}
                  <div className="items-list" style={{ margin: '10px 0' }}>
                    {order.items && order.items.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', padding: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>
                        <span style={{ fontWeight: 'bold' }}>{item.name}</span>
                        <span style={{ background: '#2563eb', padding: '0 6px', borderRadius: '4px', fontSize: '0.8em' }}>x{item.qty}</span>
                      </div>
                    ))}
                  </div>

                  {/* FIXED: Use 'eta_minutes' for AI Time */}
                  <div className="time-info">
                    <span className="icon">⏱️</span>
                    <span className="time-label">Est. Time:</span>
                    <span className="time-value">{formatTime(order.eta_minutes)}</span>
                  </div>
                </div>

                {/* Order Actions */}
                <div className="order-footer">
                  {order.status !== 'ready' && order.status !== 'collected' ? (
                    <button
                      className="complete-btn"
                      onClick={() => completeOrder(order.id)}
                      disabled={completingOrders.has(order.id)}
                    >
                      {completingOrders.has(order.id) ? (
                        <>Processing...</>
                      ) : (
                        <>
                          <span className="btn-icon">✓</span>
                          Mark Ready
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="completed-badge">
                      <span className="check-icon">✓</span>
                      Ready for Pickup
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>© 2026 Canteen Rush AI | University Cafeteria Management System</p>
      </footer>
    </div>
  );
}

export default App;