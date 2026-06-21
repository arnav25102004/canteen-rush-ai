import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import api from '../../services/api';

const STEPS = ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'];
const STEP_LABELS: Record<string, string> = { CONFIRMED: 'Confirmed', ACCEPTED: 'Accepted', PREPARING: 'Preparing', READY: 'Ready!', PICKED_UP: 'Picked Up' };

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const hasAutoOpenedUpi = useRef(false);

  async function openUpiPayment() {
    try {
      const { data } = await api.get(`/orders/${id}/payment-info`);
      const url = `upi://pay?pa=${data.vpa}&pn=${encodeURIComponent(data.payeeName)}&am=${data.amount}&tr=${encodeURIComponent(data.transactionRef)}&tn=${encodeURIComponent(data.transactionNote)}&cu=INR`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('No UPI App Found', `Please pay ₹${data.amount} to ${data.vpa} manually.\n\nReference: ${data.transactionNote}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not open UPI. Try again.');
    }
  }

  async function handleClaimPayment() {
    setClaiming(true);
    try {
      await api.post(`/orders/${id}/claim-payment`);
      load();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not submit payment claim. Try again.');
    } finally {
      setClaiming(false);
    }
  }

  const load = useCallback(async () => {
    const [orderRes] = await Promise.all([api.get(`/orders/${id}`)]);
    setOrder(orderRes.data.order);
    if (orderRes.data.order.status === 'READY') {
      const { data } = await api.get(`/orders/${id}/qr`).catch(() => ({ data: null }));
      if (data) setQrCode(data.qrCode);
    }
  }, [id]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  useEffect(() => {
    // Poll for updates when not in a terminal state
    if (!order) return;
    if (['PICKED_UP', 'CANCELLED'].includes(order.status)) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [order?.status, load]);

  useEffect(() => {
    if (!order) return;
    if (order.paymentStatus === 'AWAITING_PAYMENT' && !hasAutoOpenedUpi.current) {
      hasAutoOpenedUpi.current = true;
      openUpiPayment();
    }
  }, [order?.paymentStatus]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#e94560" /></View>;
  if (!order) return <View style={styles.center}><Text>Order not found</Text></View>;

  const currentStep = STEPS.indexOf(order.status);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f8f9fa' }} contentContainerStyle={{ padding: 20 }}>
      <View style={styles.headerCard}>
        <Text style={styles.orderNum}>{order.orderNumber}</Text>
        <Text style={styles.canteenName}>{order.canteen?.name}</Text>
        {order.slot && <Text style={styles.slotText}>📍 Pickup slot: {order.slot.startTime}–{order.slot.endTime}</Text>}
      </View>

      {/* Pay at counter banner for CASH orders */}
      {order.paymentMethod === 'CASH' && order.status !== 'PICKED_UP' && (
        <View style={styles.cashBanner}>
          <Text style={styles.cashIcon}>💵</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.cashTitle}>Pay ₹{Number(order.totalAmount).toFixed(0)} at the counter</Text>
            <Text style={styles.cashSub}>Show this screen when you pick up your order</Text>
          </View>
        </View>
      )}

      {/* UPI payment pending */}
      {order.paymentStatus === 'AWAITING_PAYMENT' && (
        <View style={styles.payBanner}>
          <Text style={styles.payBannerTitle}>Payment Required</Text>
          <Text style={styles.payBannerSub}>Pay ₹{Number(order.totalAmount).toFixed(0)} to confirm your order</Text>
          <TouchableOpacity style={styles.payNowBtn} onPress={openUpiPayment}>
            <Text style={styles.payNowBtnText}>Open UPI App</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.claimBtn, claiming && { opacity: 0.6 }]}
            onPress={handleClaimPayment}
            disabled={claiming}>
            {claiming
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.claimBtnText}>I've Paid — Confirm</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Status Stepper */}
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

      {/* QR Code */}
      {order.status === 'READY' && qrCode && (
        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Show this QR at the counter</Text>
          <View style={{ alignItems: 'center', padding: 16 }}>
            <QRCode value={qrCode} size={220} backgroundColor="#fff" color="#1a1a2e" />
          </View>
          <Text style={styles.qrHint}>Order is ready for pickup!</Text>
        </View>
      )}

      {/* Items */}
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
  cashBanner: { backgroundColor: '#f0fdf4', borderRadius: 14, padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#bbf7d0' },
  cashIcon: { fontSize: 28 },
  cashTitle: { fontSize: 14, fontWeight: '700', color: '#15803d' },
  cashSub: { fontSize: 12, color: '#166534', marginTop: 2 },
  headerCard: { backgroundColor: '#1a1a2e', borderRadius: 16, padding: 20, marginBottom: 16 },
  orderNum: { color: '#ffffff80', fontSize: 13, marginBottom: 4 },
  canteenName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  slotText: { color: '#ffffff80', fontSize: 13, marginTop: 6 },
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
  payBanner: { backgroundColor: '#fff7ed', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#fed7aa', alignItems: 'center' },
  payBannerTitle: { fontSize: 16, fontWeight: '800', color: '#c2410c', marginBottom: 4 },
  payBannerSub: { fontSize: 13, color: '#9a3412', marginBottom: 12 },
  payNowBtn: { backgroundColor: '#1a1a2e', borderRadius: 12, paddingVertical: 12, width: '100%', alignItems: 'center', marginBottom: 10 },
  payNowBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  claimBtn: { backgroundColor: '#10b981', borderRadius: 12, paddingVertical: 12, width: '100%', alignItems: 'center' },
  claimBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
