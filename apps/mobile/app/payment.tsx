import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import RazorpayCheckout from 'react-native-razorpay';
import api from '../services/api';
import { useCartStore } from '../store/cartStore';

export default function PaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    razorpayOrderId: string;
    amount: string;      // in rupees — converted to paise before passing to Razorpay
    keyId: string;
    userName: string;
    userEmail: string;
    cartJson: string;
    canteenId: string;
    slotId: string;
  }>();

  const { clear } = useCartStore();
  const [status, setStatus] = useState<'opening' | 'verifying' | 'placing' | 'done' | 'failed'>('opening');
  const [message, setMessage] = useState('');

  useEffect(() => {
    openRazorpay();
  }, []);

  async function openRazorpay() {
    const { razorpayOrderId, amount, keyId, userName, userEmail } = params;

    const options = {
      description: 'ChristEats Canteen Order',
      currency: 'INR',
      key: keyId,
      amount: String(Math.round(Number(amount) * 100)), // rupees → paise
      order_id: razorpayOrderId,
      name: 'ChristEats',
      prefill: {
        email: userEmail || '',
        contact: '',
        name: userName || 'Student',
      },
      theme: { color: '#E94560' },
    };

    try {
      const paymentData = await (RazorpayCheckout as any).open(options);
      await handlePaymentSuccess(paymentData);
    } catch (error: any) {
      // error.code === 0 means user cancelled
      if (error?.code === 0) {
        router.back();
      } else {
        setStatus('failed');
        setMessage(error?.description || 'Payment failed. Please try again.');
      }
    }
  }

  async function handlePaymentSuccess(paymentData: any) {
    setStatus('verifying');
    setMessage('Verifying payment...');

    try {
      // Verify signature with backend
      await api.post('/payments/callback', {
        razorpayOrderId: paymentData.razorpay_order_id,
        razorpayPaymentId: paymentData.razorpay_payment_id,
        signature: paymentData.razorpay_signature,
      });

      // Place the canteen order
      setStatus('placing');
      setMessage('Placing your order...');
      const cartItems = JSON.parse(params.cartJson || '[]');
      const { data } = await api.post('/orders', {
        canteenId: params.canteenId,
        slotId: params.slotId || undefined,
        paymentMethod: 'RAZORPAY',
        razorpayPaymentId: paymentData.razorpay_payment_id,
        items: cartItems,
      });

      clear();
      router.replace(`/order/${data.order.id}`);
    } catch {
      setStatus('failed');
      setMessage('Payment received but order could not be placed. Please contact support with your payment ID.');
    }
  }

  return (
    <View style={styles.center}>
      {(status === 'opening' || status === 'verifying' || status === 'placing') && (
        <>
          <ActivityIndicator size="large" color="#e94560" />
          <Text style={styles.msg}>{message || 'Opening Razorpay...'}</Text>
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
