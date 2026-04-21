import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../config/database';
import { createRazorpayOrder, verifyRazorpaySignature } from '../config/razorpay';
import { redis } from '../config/redis';

const router = Router();

const PAY_TTL = 60 * 30; // 30 minutes

async function setPayStatus(razorpayOrderId: string, data: object) {
  await redis.set(`pay:${razorpayOrderId}`, JSON.stringify(data), 'EX', PAY_TTL);
}
async function getPayStatus(razorpayOrderId: string) {
  const raw = await redis.get(`pay:${razorpayOrderId}`);
  return raw ? JSON.parse(raw) : null;
}

// ─── 1. Create Razorpay order ─────────────────────────────────────────────────
router.post('/create-order', authenticate, async (req: any, res) => {
  const { amount, receipt } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount required' });
  try {
    const razorpayOrder = await createRazorpayOrder(Number(amount), receipt || `txn_${Date.now()}`);
    await setPayStatus(razorpayOrder.id, { status: 'PENDING' });
    return res.json({ orderId: razorpayOrder.id, amount: Number(amount), currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err: any) {
    console.error('Razorpay create-order error:', err.message);
    return res.status(500).json({ error: 'Could not create Razorpay order. Check Razorpay keys.' });
  }
});

// ─── 2. Checkout HTML page (redirect mode — works in Chrome Custom Tabs) ──────
router.get('/checkout', (req, res) => {
  const { orderId, amount, name, email } = req.query as Record<string, string>;
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const amountPaise = Math.round(Number(amount) * 100);
  // Build callback URL from the incoming request so it works on any local IP
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host; // e.g. 10.40.0.20:3001
  const callbackUrl = `${proto}://${host}/api/payments/redirect-callback`;

  const safeName = (name || 'Student').replace(/['"\\]/g, '');
  const safeEmail = (email || '').replace(/['"\\]/g, '');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ChristEats — Pay</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#1a1a2e;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#fff;border-radius:20px;padding:32px 24px;text-align:center;max-width:360px;width:92%;box-shadow:0 20px 60px #0006}
    h2{color:#1a1a2e;font-size:22px;margin-bottom:6px}
    .sub{color:#888;font-size:13px;margin-bottom:20px}
    .amount{font-size:40px;font-weight:800;color:#e94560;margin-bottom:20px}
    .methods{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:24px}
    .badge{background:#f1f5f9;border-radius:6px;padding:5px 12px;font-size:12px;color:#444;font-weight:600}
    .btn{background:#e94560;color:#fff;border:none;border-radius:12px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%;transition:opacity .2s}
    .btn:active{opacity:0.8}
    #msg{margin-top:14px;font-size:13px;color:#666;min-height:18px}
  </style>
</head>
<body>
<div class="card">
  <h2>ChristEats</h2>
  <p class="sub">Secure payment via Razorpay</p>
  <div class="amount">&#8377;${Number(amount).toFixed(0)}</div>
  <div class="methods">
    <span class="badge">UPI</span>
    <span class="badge">Cards</span>
    <span class="badge">Net Banking</span>
    <span class="badge">Wallets</span>
  </div>
  <button class="btn" id="btn" onclick="startPay()">Pay Now</button>
  <p id="msg">Tap Pay Now to proceed securely</p>
</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
function startPay() {
  document.getElementById('btn').disabled = true;
  document.getElementById('msg').textContent = 'Redirecting to Razorpay…';
  if (typeof Razorpay === 'undefined') {
    document.getElementById('msg').textContent = 'Failed to load Razorpay. Check your internet connection.';
    document.getElementById('btn').disabled = false;
    return;
  }
  var rzp = new Razorpay({
    key: '${keyId}',
    amount: ${amountPaise},
    currency: 'INR',
    name: 'ChristEats',
    description: 'Canteen Order',
    order_id: '${orderId}',
    redirect: true,
    callback_url: '${callbackUrl}',
    prefill: { name: '${safeName}', email: '${safeEmail}' },
    theme: { color: '#e94560' }
  });
  rzp.open();
}
// Auto-start after scripts load
window.onload = function() { setTimeout(startPay, 800); };
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ─── 2b. Redirect callback (Razorpay POSTs here after redirect-mode payment) ─
router.post('/redirect-callback', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const valid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (valid) {
      await setPayStatus(razorpay_order_id, {
        status: 'PAID',
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
    }
    // Show success page — user closes browser and returns to app
    const html = valid
      ? `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
         <style>body{font-family:sans-serif;background:#1a1a2e;display:flex;align-items:center;justify-content:center;min-height:100vh}
         .card{background:#fff;border-radius:20px;padding:40px 24px;text-align:center;max-width:320px;width:90%}
         .icon{font-size:64px;margin-bottom:16px}.title{font-size:20px;font-weight:700;color:#10b981;margin-bottom:8px}
         .sub{color:#888;font-size:14px}</style></head>
         <body><div class="card"><div class="icon">✅</div>
         <div class="title">Payment Successful!</div>
         <p class="sub">Close this window and return to the app to track your order.</p>
         </div></body></html>`
      : `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:40px">
         <h2 style="color:#ef4444">Payment verification failed</h2>
         <p>Please contact support.</p></body></html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err: any) {
    console.error('Redirect callback error:', err.message);
    res.status(500).send('Error processing payment');
  }
});

// ─── 3. Callback from Razorpay JS ─────────────────────────────────────────────
router.post('/callback', async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, signature } = req.body;
    const valid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature);
    if (!valid) {
      await setPayStatus(razorpayOrderId, { status: 'FAILED' });
      return res.status(400).json({ error: 'Invalid signature' });
    }
    await setPayStatus(razorpayOrderId, { status: 'PAID', paymentId: razorpayPaymentId, signature });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Payment callback error:', err.message);
    return res.status(500).json({ error: 'Callback processing failed' });
  }
});

// ─── 4. Status polling ────────────────────────────────────────────────────────
router.get('/status/:razorpayOrderId', authenticate, async (req, res) => {
  try {
    const entry = await getPayStatus(req.params.razorpayOrderId);
    if (!entry) return res.json({ status: 'PENDING' });
    return res.json({ ...entry, razorpayOrderId: req.params.razorpayOrderId });
  } catch {
    return res.json({ status: 'PENDING' });
  }
});

// ─── 5. Verify + link to existing DB order ────────────────────────────────────
router.post('/verify', authenticate, async (req: any, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, signature, orderId } = req.body;
    const valid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature);
    if (!valid) return res.status(400).json({ error: 'Invalid payment signature' });
    const order = await prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED', razorpayOrderId, razorpayPaymentId },
    });
    return res.json({ success: true, order });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
