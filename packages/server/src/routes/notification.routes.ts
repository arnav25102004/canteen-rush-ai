import { Router } from 'express';
import { getNotifications, markRead, markAllRead, getAnnouncements } from '../controllers/notification.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, getNotifications);
router.patch('/:id/read', authenticate, markRead);
router.patch('/read-all', authenticate, markAllRead);
router.get('/announcements', getAnnouncements);

export default router;
