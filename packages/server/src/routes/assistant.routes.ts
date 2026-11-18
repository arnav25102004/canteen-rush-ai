import { Response } from 'express';
import { Router } from '../utils/router';
import { authenticate, AuthRequest, requireCustomer } from '../middleware/auth';
import { userLimiter } from '../middleware/rateLimit';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { handOffProposal, ProposalError } from '../assistant/proposals';
import { assistantDisabledReason, isPilotAllowed, loadAssistantConfig } from '../assistant/config';
import { getUsageToday, MAX_TURNS_PER_USER } from '../assistant/budget';
import { governor } from '../assistant/provider/modelGovernor';
import { logger } from '../utils/logger';
import { requireAssistantEnabled } from '../assistant/enabled';
import { createConversation, deleteConversations, getCurrentConversation, postTurn, reportMessage } from '../controllers/assistant.controller';

const router = Router();

/**
 * What the app needs to decide whether to show the assistant. Works when the
 * feature is off (enabled:false), so the app can hide the button.
 */
router.get('/capabilities', authenticate, async (req: AuthRequest, res: Response) => {
  const cfg = loadAssistantConfig();
  const off = assistantDisabledReason(cfg);
  if (off) return res.json({ enabled: false, available: false, reason: off, turnsLeftToday: 0 });
  if (!isPilotAllowed(req.user?.email, cfg)) return res.json({ enabled: false, available: false, reason: 'pilot', turnsLeftToday: 0 });

  let usage: { turns: number; globalTokens: number };
  try {
    usage = await getUsageToday(req.user!.id);
  } catch (err) {
    logger.warn('assistant capabilities usage lookup failed', { error: (err as Error)?.message });
    return res.json({ enabled: true, available: false, reason: 'unavailable', turnsLeftToday: 0 });
  }
  const turnsLeftToday = Math.max(0, MAX_TURNS_PER_USER - usage.turns);
  if (!governor.anyBreakerClosed(cfg)) return res.json({ enabled: true, available: false, reason: 'busy', turnsLeftToday });
  if (usage.globalTokens >= cfg.globalDailyTokens) return res.json({ enabled: true, available: false, reason: 'busy', turnsLeftToday });
  return res.json({ enabled: true, available: true, turnsLeftToday });
});

/**
 * Turns an order card into cart contents. Works even when the assistant is switched off, so a
 * card shown earlier still opens. Nothing is ordered here; the student pays at normal checkout.
 */
router.post(
  '/proposals/:id/checkout',
  authenticate,
  requireCustomer,
  userLimiter('assistant-handoff', 60_000, 20),
  async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { institutionId: true } });
    if (!user?.institutionId) throw new AppError(400, 'Your account has no campus set');
    try {
      const result = await handOffProposal(req.user!.id, req.user!.role, String(req.params.id), user.institutionId);
      return res.json(result);
    } catch (err) {
      if (err instanceof ProposalError) return res.status(err.status).json({ error: err.message, code: err.code });
      throw err;
    }
  },
);

/** One assistant turn: a message or a chip action. */
router.post('/turn', authenticate, requireCustomer, requireAssistantEnabled, userLimiter('assistant-turn', 60_000, 8), postTurn);

router.get('/conversations/current', authenticate, requireCustomer, requireAssistantEnabled, getCurrentConversation);
router.post('/conversations', authenticate, requireCustomer, requireAssistantEnabled, createConversation);
/** Works even when the assistant is off, so students can always delete their chats. */
router.delete('/conversations', authenticate, requireCustomer, deleteConversations);
router.post('/messages/:id/report', authenticate, requireCustomer, userLimiter('assistant-report', 60 * 60_000, 20), reportMessage);

export default router;
