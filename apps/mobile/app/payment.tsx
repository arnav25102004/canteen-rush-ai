import { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter, useLocalSearchParams } from 'expo-router';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';

export default function PaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    razorpayOrderId: string;
    amount: string;
    keyId: string;
    userName: string;
    userEmail: string;
    cartJson: string;
    canteenId: string;
    slotId: string;
    baseUrl: string;
  }>();

  const { clear } = useCartStore();
  const [status, setStatus] = useState<'opening' | 'polling' | 'placing' | 'done' | 'failed'>('opening');
  const [message, setMessage] = useState('Opening payment page...');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    openPayment();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function openPayment() {
    const { razorpayOrderId, amount, userName, userEmail, baseUrl } = params;
    const url = `${baseUrl}/payment/checkout?orderId=${razorpayOrderId}&amount=${amount}&name=${encodeURIComponent(userName || 'Student')}&email=${encodeURIComponent(userEmail || '')}`;

    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: '#1a1a2e',
      controlsColor: '#e94560',
    });

    // Browser closed — start polling for payment status
    setStatus('polling');
    setMessage('Checking payment status...');
    startPolling();
  }

  function startPolling() {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const { data } = await api.get(`/payment/status/${params.razorpayOrderId}`);
        if (data.status === 'PAID') {
          clearInterval(pollRef.current!);
          await placeOrder(data.paymentId);
        } else if (data.status === 'FAILED' || attempts > 10) {
          clearInterval(pollRef.current!);
          setStatus('failed');
          setMessage('Payment was not completed. Please try again.');
        }
      } catch {
        if (attempts > 10) {
          clearInterval(pollRef.current!);
          setStatus('failed');
          setMessage('Could not verify payment. Please contact support.');
        }
      }
    }, 1500);
  }

  async function placeOrder(paymentId: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    setStatus('placing');
    setMessage('Placing your order...');
    try {
      const cartItems = JSON.parse(params.cartJson || '[]');
      const { data } = await api.post('/orders', {
        canteenId: params.canteenId,
        slotId: params.slotId || undefined,
        paymentMethod: 'RAZORPAY',
        razorpayPaymentId: paymentId,
        items: cartItems,
      });
      clear();
      setStatus('done');
      router.replace(`/order/${data.order.id}`);
    } catch {
      setStatus('failed');
      setMessage('Order could not be placed. Please contact support.');
    }
  }

  return (
    <View style={styles.center}>
      {(status === 'opening' || status === 'polling' || status === 'placing') && (
        <>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.msg}>{message}</Text>
        </>
      )}
      {status === 'failed' && (
        <>
          <Text style={styles.errorIcon}>✗</Text>
          <Text style={styles.msg}>{message}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnText}>Go Back</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f9fa', padding: 32 },
  msg: { marginTop: 16, fontSize: 15, color: '#555', textAlign: 'center' },
  errorIcon: { fontSize: 48, color: '#ef4444' },
  btn: { marginTop: 24, backgroundColor: '#e94560', borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
