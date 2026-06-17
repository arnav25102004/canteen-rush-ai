import { Router } from 'express';

// Razorpay payment routes removed — students now pay vendors directly via UPI deep links.
// See order routes: POST /orders/:id/claim-payment and PATCH /vendor/orders/:id/verify-payment

const router = Router();
export default router;
