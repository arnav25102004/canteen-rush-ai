import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import api from '../../services/api';
import { getSocket } from '../../services/socket';

const STEPS = ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'];
const STEP_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready!',
  PICKED_UP: 'Picked Up',
};

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/orders/${id}`);
      setOrder(data.order);
      if (data.order.status === 'READY') {
        const qrRes = await api.get(`/orders/${id}/qr`).catch(() => ({ data: null }));
        if (qrRes.data) setQrCode(qrRes.data.qrCode);
      }
    } catch { /* silent — polling will retry */ }
  }, [id]);

  // Initial load
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // Socket.IO — instant status updates from the backend
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();

    socket.emit('join:order', { orderId: id });

    socket.on('order:status_update', (data: { orderId: string; status: string; paymentStatus?: string; pickupCode?: string }) => {
      if (data.orderId !== id) return;
      setOrder((prev: any) => prev ? { ...prev, ...data } : prev);
      // If just turned READY, fetch QR code
      if (data.status === 'READY') {
        api.get(`/orders/${id}/qr`).then(r => setQrCode(r.data.qrCode)).catch(() => null);
      }
      // Re-fetch full order for any status change to get latest data
      load();
    });

    return () => {
      socket.emit('leave:order', { orderId: id });
      socket.off('order:status_update');
    };
  }, [id, load]);

  // Polling fallback — only active while payment is still processing (webhook can take ~10s)
  useEffect(() => {
    if (!order) return;
    if (['PICKED_UP', 'CANCELLED'].includes(order.status)) return;
    // Poll faster (3s) while PENDING, slow down to 10s after payment confirms
    const interval = order.status === 'PENDING' ? 3000 : 10000;
    const timer = setInterval(load, interval);
    return () => clearInterval(timer);
  }, [order?.status, load]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;
  if (!order) return <View style={styles.center}><Text>Order not found</Text></View>;

  const isPendingPayment = order.status === 'PENDING' && order.paymentStatus === 'AWAITING_PAYMENT';
  const currentStep = STEPS.indexOf(order.status);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8f9fa' }} contentContainerStyle={{ padding: 20 }}>
      <View style={styles.headerCard}>
        <Text style={styles.orderNum}>{order.orderNumber}</Text>
        <Text style={styles.canteenName}>{order.canteen?.name}</Text>
        {order.pickupCode && (
          <Text style={styles.pickupCode}>Pickup code: {order.pickupCode}</Text>
        )}
        {order.slot && <Text style={styles.slotText}>📍 Pickup slot: {order.slot.startTime}–{order.slot.endTime}</Text>}
      </View>

      {/* Cash payment banner — shown for pay-at-counter orders */}
      {order.paymentMethod === 'CASH' && !['PICKED_UP', 'CANCELLED'].includes(order.status) && (
        <View style={styles.cashBanner}>
          <Text style={styles.cashBannerTitle}>💵 Pay at Counter</Text>
          <Text style={styles.cashBannerText}>
            Show your pickup code to the vendor and pay ₹{Number(order.totalAmount).toFixed(0)} in cash when you collect.
          </Text>
        </View>
      )}

      {/* Payment processing banner — shown while waiting for Razorpay webhook */}
      {isPendingPayment && (
        <View style={styles.processingBanner}>
          <ActivityIndicator color="#7e22ce" size="small" style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.processingTitle}>Processing Payment…</Text>
            <Text style={styles.processingSub}>Please wait. Your order will confirm automatically once payment clears.</Text>
          </View>
        </View>
      )}

      {/* Cancelled state */}
      {order.status === 'CANCELLED' && (
        <View style={styles.cancelledBanner}>
          <Text style={styles.cancelledText}>
            {order.paymentStatus === 'FAILED'
              ? '❌ Payment failed — your order was cancelled.'
              : `❌ Order cancelled${order.cancelReason ? `: ${order.cancelReason}` : '.'}`}
          </Text>
        </View>
      )}

      {/* Status Stepper — only shown after payment is confirmed */}
      {!isPendingPayment && order.status !== 'CANCELLED' && (
        <View style={styles.stepper}>
          {STEPS.filter(s => s !== 'PICKED_UP' || order.status === 'PICKED_UP').map((step, i) => {
            const done = i <= currentStep;
            const active = i === currentStep;
            return (
              <View key={step} style={{ alignItems: 'center', flex: 1 }}>
                <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
                  {done && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                </View>
                <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{STEP_LABELS[step]}</Text>
                {i < STEPS.length - 2 && <View style={[styles.stepLine, done && styles.stepLineDone]} />}
              </View>
            );
          })}
        </View>
      )}

      {/* QR Code — shown when food is ready for pickup */}
      {order.status === 'READY' && qrCode && (
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Show this QR at the counter</Text>
          <View style={{ alignItems: 'center', padding: 16 }}>
            <QRCode value={qrCode} size={220} backgroundColor="#fff" color="#1a1a2e" />
          </View>
          {order.pickupCode && (
            <Text style={styles.pickupCodeLarge}>{order.pickupCode}</Text>
          )}
          <Text style={styles.qrHint}>Your food is ready — head to the counter!</Text>
        </View>
      )}

      {/* Order Items */}
      <View style={styles.itemsCard}>
        <Text style={styles.sectionTitle}>Order Items</Text>
        {order.items?.map((item: any, i: number) => (
          <View key={i} style={styles.itemRow}>
            <Text style={styles.itemName}>{item.menuItem.name}</Text>
            <Text style={styles.itemQty}>×{item.quantity}</Text>
            <Text style={styles.itemPrice}>₹{Number(item.totalPrice).toFixed(0)}</Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.itemRow}>
          <Text style={[styles.itemName, { fontWeight: '700' }]}>Total</Text>
          <Text style={[styles.itemPrice, { fontWeight: '700' }]}>₹{Number(order.totalAmount).toFixed(0)}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.refreshBtn} onPress={load}>
        <Text style={styles.refreshBtnText}>↻ Refresh</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, marginBottom: 16 },
  orderNum: { color: '#ffffff80', fontSize: 13, marginBottom: 4 },
  canteenName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  pickupCode: { color: '#e94560', fontSize: 15, fontWeight: '700', marginTop: 6 },
  slotText: { color: '#ffffff80', fontSize: 13, marginTop: 6 },
  processingBanner: { backgroundColor: '#faf5ff', borderRadius: 14, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e9d5ff' },
  processingTitle: { fontSize: 14, fontWeight: '700', color: '#7e22ce', marginBottom: 2 },
  processingSub: { fontSize: 12, color: '#6b21a8' },
  cancelledBanner: { backgroundColor: '#fef2f2', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#fecaca' },
  cancelledText: { fontSize: 14, color: '#b91c1c', fontWeight: '600' },
  stepper: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16 },
  stepDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#e5e7eb', marginBottom: 6, justifyContent: 'center', alignItems: 'center' },
  stepDotDone: { backgroundColor: '#10b981' },
  stepDotActive: { backgroundColor: '#e94560' },
  stepLabel: { fontSize: 9, color: '#aaa', textAlign: 'center' },
  stepLabelDone: { color: '#333', fontWeight: '600' },
  stepLine: { position: 'absolute', right: -14, top: 10, width: 28, height: 3, backgroundColor: '#e5e7eb' },
  stepLineDone: { backgroundColor: '#10b981' },
  qrCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center', elevation: 2, shadowColor: '#10b981', shadowOpacity: 0.2, shadowRadius: 8 },
  qrTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  pickupCodeLarge: { fontSize: 36, fontWeight: '900', color: '#e94560', letterSpacing: 2, marginTop: 8 },
  qrHint: { color: '#10b981', fontWeight: '600', marginTop: 8 },
  itemsCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  itemName: { flex: 1, fontSize: 14, color: '#333' },
  itemQty: { fontSize: 14, color: '#888', marginHorizontal: 8 },
  itemPrice: { fontSize: 14, color: '#1a1a2e' },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 8 },
  refreshBtn: { backgroundColor: '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' },
  refreshBtnText: { color: '#555', fontWeight: '600' },
  cashBanner: { backgroundColor: '#fffbeb', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#fde68a' },
  cashBannerTitle: { fontSize: 14, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  cashBannerText: { fontSize: 13, color: '#78350f', lineHeight: 18 },
});
