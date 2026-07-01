import { Router } from 'express';
import { deleteAccount } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// DELETE /api/user/account — Google Play Store requires in-app account deletion
router.delete('/account', authenticate, deleteAccount);

export default router;
