import { Router } from 'express';
import {
  createOrder, getMyOrders, getOrder, getOrderQR,
  studentCancelOrder, getVendorOrders, updateOrderStatus, scanQR, getPrepSheet,
  getLastOrder, respondToOrder,
} from '../controllers/order.controller';
import { authenticate, requireVendor } from '../middleware/auth';

const router = Router();

// Student routes
router.post('/', authenticate, createOrder);
router.get('/last-order', authenticate, getLastOrder);
router.get('/', authenticate, getMyOrders);
router.get('/:id', authenticate, getOrder);
router.get('/:id/qr', authenticate, getOrderQR);
router.post('/:id/cancel', authenticate, studentCancelOrder);

// Vendor routes (mounted at /api/vendor/orders)
router.get('/vendor/list', authenticate, requireVendor, getVendorOrders);
router.patch('/vendor/:id/status', authenticate, requireVendor, updateOrderStatus);
router.patch('/vendor/:id/respond', authenticate, requireVendor, respondToOrder);
router.post('/vendor/:id/scan', authenticate, requireVendor, scanQR);
router.get('/vendor/prep-sheet', authenticate, requireVendor, getPrepSheet);

export default router;
