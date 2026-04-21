import { Router } from 'express';
import { register, getMe, updateMe, saveFcmToken, devLogin } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/dev-login', devLogin); // dev-only: works without Firebase
router.post('/register', register);
router.get('/me', authenticate, getMe);
router.put('/me', authenticate, updateMe);
router.post('/fcm-token', authenticate, saveFcmToken);

export default router;
