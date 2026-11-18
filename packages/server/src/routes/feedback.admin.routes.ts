import { Router } from '../utils/router';
import { authenticate, requireFeedbackAdmin } from '../middleware/auth';
import { userLimiter } from '../middleware/rateLimit';
import { list, stats, detail, patch, note, reply, reports, moderate, bulk, dashboard, exportCsv } from '../controllers/feedback.admin.controller';

const router = Router();

// Not the global requireAdmin: that one excludes SUPER_ADMIN. Every handler also applies feedbackScope().
router.use(authenticate, requireFeedbackAdmin);

router.get('/', list);
// Fixed paths before '/:id'.
router.get('/stats', stats);
router.get('/stats/dashboard', dashboard);
router.get('/reports', reports);
router.get('/export.csv', userLimiter('feedback-export', 60 * 60 * 1000, 5), exportCsv);
router.post('/bulk', bulk);
router.get('/:id', detail);
router.patch('/:id', patch);
router.post('/:id/notes', note);
router.post('/:id/reply', reply);
router.post('/:id/moderate', moderate);

export default router;
