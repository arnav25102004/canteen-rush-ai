import { Router } from '../utils/router';
import { authenticate, requireFeedbackAdmin } from '../middleware/auth';
import { adminList, adminPublish } from '../controllers/feedbackRewards.controller';

const router = Router();

// ADMIN and SUPER_ADMIN; the handlers apply feedbackScope() to every linked item.
router.use(authenticate, requireFeedbackAdmin);
router.get('/', adminList);
router.post('/', adminPublish);

export default router;
