import { Router } from 'express';
import { generateSlots, updateSlot, toggleSlot } from '../controllers/slot.controller';
import { authenticate, requireVendor } from '../middleware/auth';

const router = Router();

router.post('/generate', authenticate, requireVendor, generateSlots);
router.put('/:id', authenticate, requireVendor, updateSlot);
router.patch('/:id/toggle', authenticate, requireVendor, toggleSlot);

export default router;
