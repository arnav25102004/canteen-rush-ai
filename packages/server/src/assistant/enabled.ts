import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { assistantDisabledReason, isPilotAllowed, loadAssistantConfig } from './config';

/**
 * 404 ASSISTANT_DISABLED when the feature is off (flag, missing key) or the student is not on the
 * pilot list while one is set. Mount after `authenticate`.
 */
export function requireAssistantEnabled(req: AuthRequest, res: Response, next: NextFunction) {
  const cfg = loadAssistantConfig();
  if (assistantDisabledReason(cfg) || !isPilotAllowed(req.user?.email, cfg)) {
    return res.status(404).json({ error: 'The assistant is not available', code: 'ASSISTANT_DISABLED' });
  }
  next();
}
