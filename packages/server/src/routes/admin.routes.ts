import { Router } from 'express';
import {
  listVendors, assignVendorToCanteen,
  createAnnouncement, toggleAnnouncement, listAnnouncements,
  getSettlements, markSettlementPaid,
  listUsers, updateUserRole,
} from '../controllers/admin.controller';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/vendors', listVendors);
router.post('/vendors/assign', assignVendorToCanteen);
router.post('/announcements', createAnnouncement);
router.get('/announcements', listAnnouncements);
router.patch('/announcements/:id/toggle', toggleAnnouncement);

router.get('/settlements', getSettlements);
router.post('/settlements/:id/mark-paid', markSettlementPaid);

router.get('/users', listUsers);
router.patch('/users/:id/role', updateUserRole);

export default router;
