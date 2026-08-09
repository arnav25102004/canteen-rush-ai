import { Router } from 'express';
import {
  createOrder, getMyOrders, getOrder, getOrderQR,
  studentCancelOrder, getVendorOrders, updateOrderStatus, scanQR, getPrepSheet,
  getLastOrder, respondToOrder, claimPayment, verifyPayment, getPaymentInfo,
} from '../controllers/order.controller';
import { authenticate, requireVendor } from '../middleware/auth';
import { placeOrderLimiter, paymentActionLimiter } from '../middleware/rateLimit';

const router = Router();

// Vendor routes — must be before /:id to avoid wildcard capture
router.get('/vendor/list', authenticate, requireVendor, getVendorOrders);
router.get('/vendor/prep-sheet', authenticate, requireVendor, getPrepSheet);
router.patch('/vendor/:id/status', authenticate, requireVendor, updateOrderStatus);
router.patch('/vendor/:id/respond', authenticate, requireVendor, respondToOrder);
router.patch('/vendor/:id/verify-payment', authenticate, requireVendor, verifyPayment);
router.post('/vendor/:id/scan', authenticate, requireVendor, scanQR);

// Student routes.
// Reads are unthrottled beyond the global ceiling — the app polls these and a
// blanket 5/min here used to lock students out of their own order list.
// Writes that create orders or move money are limited per user.
router.post('/', authenticate, placeOrderLimiter, createOrder);
router.get('/last-order', authenticate, getLastOrder);
router.get('/', authenticate, getMyOrders);
router.get('/:id', authenticate, getOrder);
router.get('/:id/qr', authenticate, getOrderQR);
router.post('/:id/cancel', authenticate, paymentActionLimiter, studentCancelOrder);
router.post('/:id/claim-payment', authenticate, paymentActionLimiter, claimPayment);
router.get('/:id/payment-info', authenticate, getPaymentInfo);

export default router;
