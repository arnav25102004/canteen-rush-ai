import { Router } from 'express';
import { listVendors, assignVendorToCanteen, createAnnouncement, toggleAnnouncement, listAnnouncements } from '../controllers/admin.controller';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/vendors', listVendors);
router.post('/vendors/assign', assignVendorToCanteen);
router.post('/announcements', createAnnouncement);
router.get('/announcements', listAnnouncements);
router.patch('/announcements/:id/toggle', toggleAnnouncement);

export default router;
