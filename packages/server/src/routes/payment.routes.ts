import { Router } from 'express';
import { razorpayWebhook } from '../controllers/payment.controller';

const router = Router();

// No auth middleware — Razorpay calls this server-to-server
// Signature is verified inside the handler using rawBody + RAZORPAY_WEBHOOK_SECRET
router.post('/webhook', razorpayWebhook);

export default router;
