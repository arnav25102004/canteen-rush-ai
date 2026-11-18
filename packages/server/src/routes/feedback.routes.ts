import { Router } from '../utils/router';
import { authenticate } from '../middleware/auth';
import { userLimiter } from '../middleware/rateLimit';
import { streak, canteenSummary, changelog } from '../controllers/feedbackRewards.controller';
import multer from 'multer';
import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { MAX_ATTACHMENT_BYTES } from '../services/feedbackExtras.service';
import { attach, ideas, vote, unvote, eligibility, createOrder, createApp, update, remove, mine, getOne } from '../controllers/feedback.controller';

const router = Router();

// In-memory, one image, 5 MB. The real type check is done on the bytes in the service.
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 5 } });
function singleImage(req: Request, res: Response, next: NextFunction) {
  memUpload.single('image')(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'Image is too large (5 MB max)', 'TOO_LARGE'));
    return next(new AppError(400, 'Invalid upload', 'BAD_UPLOAD'));
  });
}

const attachLimiter = userLimiter('feedback-attach', 60 * 60 * 1000, 10);
const voteLimiter = userLimiter('feedback-vote', 60 * 60 * 1000, 30);
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
router.get('/ideas', authenticate, ideas);
router.post('/:id/attachments', authenticate, attachLimiter, singleImage, attach);
router.post('/:id/vote', authenticate, voteLimiter, vote);
router.delete('/:id/vote', authenticate, voteLimiter, unvote);
router.get('/:id', authenticate, getOne);
router.patch('/:id', authenticate, editLimiter, update);
router.delete('/:id', authenticate, editLimiter, remove);

export default router;
