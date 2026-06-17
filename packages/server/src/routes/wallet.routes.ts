import { Router } from 'express';
import { getWallet, getTransactions, getSpendingSummary } from '../controllers/wallet.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Wallet is now a refund-credit holder only (no Razorpay recharge)
router.get('/', authenticate, getWallet);
router.get('/transactions', authenticate, getTransactions);
router.get('/spending-summary', authenticate, getSpendingSummary);

export default router;
