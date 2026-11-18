import { Router } from '../utils/router';
import { authenticate, requireFeedbackAdmin } from '../middleware/auth';
import { list, stats, detail, patch, note, reply } from '../controllers/feedback.admin.controller';

const router = Router();

// Not the global requireAdmin: that one excludes SUPER_ADMIN. Every handler also applies feedbackScope().
router.use(authenticate, requireFeedbackAdmin);

router.get('/', list);
router.get('/stats', stats); // before '/:id'
router.get('/:id', detail);
router.patch('/:id', patch);
router.post('/:id/notes', note);
router.post('/:id/reply', reply);

export default router;
