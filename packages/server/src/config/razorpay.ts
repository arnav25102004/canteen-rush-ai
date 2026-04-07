import crypto from 'crypto';

// Lazy-load Razorpay so missing keys don't crash the server on startup
let _razorpay: any = null;
export function getRazorpay() {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID) {
      console.warn('Razorpay not configured — payment endpoints will not work');
      return null;
    }
    const Razorpay = require('razorpay');
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
}

export async function createRazorpayOrder(amount: number, receipt: string) {
  const rp = getRazorpay();
  if (!rp) throw new Error('Razorpay not configured');
  return rp.orders.create({ amount: Math.round(amount * 100), currency: 'INR', receipt });
}

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(body).digest('hex');
  return expected === signature;
}
