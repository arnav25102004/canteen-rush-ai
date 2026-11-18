import { Router } from '../utils/router';
import { authenticate } from '../middleware/auth';
import { userLimiter } from '../middleware/rateLimit';
import { streak, canteenSummary, changelog } from '../controllers/feedbackRewards.controller';
import { eligibility, createOrder, createApp, update, remove, mine, getOne } from '../controllers/feedback.controller';

const router = Router();

const createLimiter = userLimiter('feedback-create', 60 * 60 * 1000, 10);
const editLimiter = userLimiter('feedback-edit', 60 * 60 * 1000, 20);

// Fixed paths first so '/mine' is not read as an :id.
router.get('/eligibility/:orderId', authenticate, eligibility);
router.get('/mine', authenticate, mine);
router.get('/streak', authenticate, streak);
router.get('/changelog', authenticate, changelog);
router.get('/canteen/:id/summary', authenticate, canteenSummary);
router.post('/order', authenticate, createLimiter, createOrder);
router.post('/app', authenticate, createLimiter, createApp);
router.get('/:id', authenticate, getOne);
router.patch('/:id', authenticate, editLimiter, update);
router.delete('/:id', authenticate, editLimiter, remove);

export default router;
