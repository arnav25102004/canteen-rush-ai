import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../middleware/auth';
import { getLoyaltyAccount, getRedemptionTiers, validatePointsRedemption } from '../services/loyalty.service';

const router = Router();

// Get student's points balance + recent transactions
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const account = await getLoyaltyAccount(req.user!.id);
  if (!account) {
    return res.json({ account: { totalPoints: 0, lifetimePoints: 0, totalSaved: 0, transactions: [] } });
  }
  return res.json({ account });
});

// Get redemption tiers (public)
router.get('/tiers', (_req, res: Response) => {
  return res.json({ tiers: getRedemptionTiers() });
});

// Check if student can redeem X points
router.post('/validate-redemption', authenticate, async (req: AuthRequest, res: Response) => {
  const { pointsToRedeem } = req.body;
  if (typeof pointsToRedeem !== 'number') return res.status(400).json({ error: 'pointsToRedeem must be a number' });
  const result = await validatePointsRedemption(req.user!.id, pointsToRedeem);
  return res.json(result);
});

export default router;
