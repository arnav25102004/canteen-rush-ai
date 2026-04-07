import { Router } from 'express';
import { vendorSummary, vendorPopularItems, vendorPeakHours, adminOverview, adminCanteenRevenue } from '../controllers/analytics.controller';
import { authenticate, requireVendor, requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/vendor/summary', authenticate, requireVendor, vendorSummary);
router.get('/vendor/popular-items', authenticate, requireVendor, vendorPopularItems);
router.get('/vendor/peak-hours', authenticate, requireVendor, vendorPeakHours);
router.get('/admin/overview', authenticate, requireAdmin, adminOverview);
router.get('/admin/canteen-revenue', authenticate, requireAdmin, adminCanteenRevenue);

export default router;
