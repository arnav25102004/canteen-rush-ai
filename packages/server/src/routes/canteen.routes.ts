import { Router } from 'express';
import {
  listCanteens, getCanteen, getCanteenLiveStats,
  createCanteen, updateCanteen, deactivateCanteen, updateMyCanteenUpi,
} from '../controllers/canteen.controller';
import { getCanteenMenu, searchMenuInCanteen, searchMenuGlobal } from '../controllers/menu.controller';
import { listSlotsForCanteen } from '../controllers/slot.controller';
import { authenticate, requireAdmin, requireVendor, optionalAuthenticate } from '../middleware/auth';

const router = Router();

router.get('/', listCanteens);
router.get('/search', searchMenuGlobal);
router.get('/:id', getCanteen);
router.get('/:id/live-stats', getCanteenLiveStats);
router.get('/:id/menu', getCanteenMenu);
router.get('/:id/menu/search', searchMenuInCanteen);
router.get('/:id/slots', optionalAuthenticate, listSlotsForCanteen);

// Vendor — update own canteen UPI details
router.patch('/my/upi', authenticate, requireVendor, updateMyCanteenUpi);

// Admin only
router.post('/', authenticate, requireAdmin, createCanteen);
router.put('/:id', authenticate, requireAdmin, updateCanteen);
router.delete('/:id', authenticate, requireAdmin, deactivateCanteen);

export default router;
