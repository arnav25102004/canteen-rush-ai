import { Router } from 'express';
import { register, getMe, updateMe, saveFcmToken } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);
router.post('/fcm-token', authenticate, saveFcmToken);

export default router;
