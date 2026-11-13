import { Router } from '../utils/router';
import {
  listCanteens, getCanteen, getCanteenLiveStats,
  createCanteen, updateCanteen, deactivateCanteen, getMyCanteen, updateMyCanteen,
} from '../controllers/canteen.controller';
import { getCanteenMenu, searchMenuInCanteen, searchMenuGlobal } from '../controllers/menu.controller';
import { listSlotsForCanteen } from '../controllers/slot.controller';
import { authenticate, requireAdmin, requireVendor, optionalAuthenticate } from '../middleware/auth';

const router = Router();

// Vendor's own canteen — must be registered before /:id
router.get('/my', authenticate, requireVendor, getMyCanteen);
router.put('/my', authenticate, requireVendor, updateMyCanteen);

router.get('/', listCanteens);
router.get('/search', searchMenuGlobal);
router.get('/:id', getCanteen);
router.get('/:id/live-stats', getCanteenLiveStats);
router.get('/:id/menu', getCanteenMenu);
router.get('/:id/menu/search', searchMenuInCanteen);
router.get('/:id/slots', optionalAuthenticate, listSlotsForCanteen);

// Admin only
router.post('/', authenticate, requireAdmin, createCanteen);
router.put('/:id', authenticate, requireAdmin, updateCanteen);
router.delete('/:id', authenticate, requireAdmin, deactivateCanteen);

export default router;
