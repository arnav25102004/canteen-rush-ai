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

  // Mark order as complete
  const completeOrder = async (orderId) => {
    setCompletingOrders(prev => new Set([...prev, orderId]));

    try {
      await axios.post(`http://localhost:8000/complete/${orderId}`);
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
      case 'pending':
        return 'status-pending';
      case 'preparing':
        return 'status-preparing';
      case 'ready':
        return 'status-ready';
      case 'completed':
        return 'status-completed';
      default:
        return 'status-pending';
    }
  };

  // Format time display
  const formatTime = (minutes) => {
    if (!minutes) return 'N/A';
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
              <span className="stat-value">{orders.filter(o => o.status !== 'completed').length}</span>
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
                className={`order-card ${getStatusColor(order.status)} ${completingOrders.has(order.id) ? 'completing' : ''
                  }`}
              >
                {/* Order Header */}
                <div className="order-header">
                  <div className="order-id">
                    <span className="label">Order</span>
                    <span className="value">#{order.id}</span>
                  </div>
                  <div className={`status-badge ${getStatusColor(order.status)}`}>
                    {order.status || 'Pending'}
                  </div>
                </div>

                {/* Order Details */}
                <div className="order-body">
                  <div className="student-info">
                    <span className="icon">👤</span>
                    <span className="student-id">Student ID: {order.student_id}</span>
                  </div>

                  <div className="item-info">
                    <div className="item-name">{order.item}</div>
                    <div className="item-qty">
                      <span className="qty-badge">Qty: {order.qty}</span>
                    </div>
                  </div>

                  <div className="time-info">
                    <span className="icon">⏱️</span>
                    <span className="time-label">Est. Time:</span>
                    <span className="time-value">{formatTime(order.predicted_time)}</span>
                  </div>
                </div>

                {/* Order Actions */}
                <div className="order-footer">
                  {order.status?.toLowerCase() !== 'completed' && (
                    <button
                      className="complete-btn"
                      onClick={() => completeOrder(order.id)}
                      disabled={completingOrders.has(order.id)}
                    >
                      {completingOrders.has(order.id) ? (
                        <>
                          <span className="btn-spinner"></span>
                          Processing...
                        </>
                      ) : (
                        <>
                          <span className="btn-icon">✓</span>
                          Mark as Complete
                        </>
                      )}
                    </button>
                  )}
                  {order.status?.toLowerCase() === 'completed' && (
                    <div className="completed-badge">
                      <span className="check-icon">✓</span>
                      Completed
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
