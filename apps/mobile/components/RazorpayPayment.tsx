import RazorpayCheckout from 'react-native-razorpay';
import { CONFIG } from '../config';

export interface PaymentOptions {
  orderId: string;
  amount: number;    // in rupees
  email: string;
  name: string;
  phone?: string;
  description?: string;
}

export interface PaymentResult {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export async function openRazorpayCheckout(options: PaymentOptions): Promise<PaymentResult> {
  const razorpayOptions = {
    description: options.description || 'ChristEats Payment',
    currency: 'INR',
    key: CONFIG.RAZORPAY_KEY_ID,
    amount: Math.round(options.amount * 100),
    order_id: options.orderId,
    name: 'ChristEats',
    prefill: {
      email: options.email,
      name: options.name,
      contact: options.phone || '',
    },
    theme: { color: '#e94560' },
  };

  try {
    const result = await (RazorpayCheckout as any).open(razorpayOptions);
    return result as PaymentResult;
  } catch (error: any) {
    const code = error?.code ?? error?.error?.code;
    if (code === 0 || code === 'PAYMENT_CANCELLED') {
      throw new Error('PAYMENT_CANCELLED');
    }
    throw new Error(error?.description || error?.error?.description || error?.message || 'Payment failed');
  }
}
