import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { prisma } from '../config/database';
import { createRazorpayOrder, rechargeWallet } from '../services/payment.service';

const router = Router();

// Direct payment (non-wallet) for order
router.post('/create-order', authenticate, async (req: any, res) => {
  const { amount, orderId } = req.body;
  if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId required' });

  const receipt = `order_${orderId}`;
  const razorpayOrder = await createRazorpayOrder(amount, receipt);
  return res.json({ razorpayOrderId: razorpayOrder.id, amount, currency: 'INR' });
});

router.post('/verify', authenticate, async (req: any, res) => {
  const { razorpayOrderId, razorpayPaymentId, signature, orderId } = req.body;
  const { verifyRazorpaySignature } = await import('../config/razorpay');

  const valid = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature);
  if (!valid) return res.status(400).json({ error: 'Invalid payment signature' });

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { paymentStatus: 'PAID', status: 'CONFIRMED', razorpayOrderId, razorpayPaymentId },
  });

  return res.json({ success: true, order });
});

export default router;
