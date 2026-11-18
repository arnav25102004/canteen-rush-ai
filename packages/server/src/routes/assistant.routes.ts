import { Response } from 'express';
import { Router } from '../utils/router';
import { authenticate, AuthRequest } from '../middleware/auth';
import { assistantDisabledReason, isPilotAllowed, loadAssistantConfig } from '../assistant/config';
import { getUsageToday, MAX_TURNS_PER_USER } from '../assistant/budget';
import { governor } from '../assistant/provider/modelGovernor';
import { logger } from '../utils/logger';

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

export default router;
