import { Router } from 'express';
import {
  createOrder, getMyOrders, getOrder, getOrderQR,
  studentCancelOrder, getVendorOrders, updateOrderStatus, scanQR, getPrepSheet,
  getLastOrder, respondToOrder, claimPayment, verifyPayment,
} from '../controllers/order.controller';
import { authenticate, requireVendor } from '../middleware/auth';

const router = Router();

// Vendor routes — must be before /:id to avoid wildcard capture
router.get('/vendor/list', authenticate, requireVendor, getVendorOrders);
router.get('/vendor/prep-sheet', authenticate, requireVendor, getPrepSheet);
router.patch('/vendor/:id/status', authenticate, requireVendor, updateOrderStatus);
router.patch('/vendor/:id/respond', authenticate, requireVendor, respondToOrder);
router.patch('/vendor/:id/verify-payment', authenticate, requireVendor, verifyPayment);
router.post('/vendor/:id/scan', authenticate, requireVendor, scanQR);

// Student routes
router.post('/', authenticate, createOrder);
router.get('/last-order', authenticate, getLastOrder);
router.get('/', authenticate, getMyOrders);
router.get('/:id', authenticate, getOrder);
router.get('/:id/qr', authenticate, getOrderQR);
router.post('/:id/cancel', authenticate, studentCancelOrder);
router.post('/:id/claim-payment', authenticate, claimPayment);

export default router;
