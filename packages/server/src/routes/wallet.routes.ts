import { Router } from 'express';
import { getWallet, getTransactions, initiateRecharge, verifyRecharge, getSpendingSummary } from '../controllers/wallet.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, getWallet);
router.get('/transactions', authenticate, getTransactions);
router.post('/recharge', authenticate, initiateRecharge);
router.post('/recharge/verify', authenticate, verifyRecharge);
router.get('/spending-summary', authenticate, getSpendingSummary);

export default router;
