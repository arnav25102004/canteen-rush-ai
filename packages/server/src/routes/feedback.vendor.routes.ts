import { UserRole } from '@prisma/client';
import { Router } from '../utils/router';
import { authenticate, requireRole } from '../middleware/auth';
import { userLimiter } from '../middleware/rateLimit';
import { list, summary, reply, flag } from '../controllers/feedback.vendor.controller';

const router = Router();

// VENDOR only: an ADMIN account goes through /api/admin/feedback, never the anonymised vendor view.
router.use(authenticate, requireRole(UserRole.VENDOR));

const writeLimiter = userLimiter('vendor-feedback-write', 60 * 60 * 1000, 60);

// Fixed paths before '/:id/...'.
router.get('/summary', summary);
router.get('/', list);
router.post('/:id/reply', writeLimiter, reply);
router.post('/:id/flag-unfair', writeLimiter, flag);

export default router;
