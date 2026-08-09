import rateLimit, { Options } from 'express-rate-limit';
import { Request } from 'express';
import { AuthRequest } from './auth';
import { logger } from '../utils/logger';

/**
 * Rate limiting notes for this deployment:
 *
 * Students use the app from campus WiFi, which NATs a large number of devices
 * behind a single public IP. Purely IP-keyed limits therefore punish the whole
 * campus for one heavy user, so IP limits here are deliberately coarse and act
 * only as a blunt DoS guard.
 *
 * Meaningful per-actor limits are keyed on the authenticated user id instead
 * (`userLimiter`), and must be mounted AFTER `authenticate` so req.user exists.
 */

function build(name: string, opts: Partial<Options> & Pick<Options, 'windowMs' | 'max'>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit hit', {
        limiter: name,
        ip: req.ip,
        userId: (req as AuthRequest).user?.id,
        path: req.path,
      });
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
    },
    ...opts,
  });
}

/** Coarse per-IP ceiling. Sized for shared campus NAT, not per-user fairness. */
export const globalLimiter = build('global', {
  windowMs: 15 * 60 * 1000,
  max: 2000,
});

/**
 * Credential endpoints. Still per-IP because there is no authenticated user
 * yet, but generous enough to survive a NAT'd campus while blocking a
 * sustained brute force.
 */
export const authLimiter = build('auth', {
  windowMs: 15 * 60 * 1000,
  max: 100,
});

export const forgotPasswordLimiter = build('forgot-password', {
  windowMs: 60 * 60 * 1000,
  max: 20,
});

/** Per-authenticated-user limiter. Mount after `authenticate`. */
export function userLimiter(name: string, windowMs: number, max: number) {
  return build(name, {
    windowMs,
    max,
    keyGenerator: (req: Request) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
  });
}

/** Placing orders is the expensive, money-adjacent path — tight, per user. */
export const placeOrderLimiter = userLimiter('place-order', 60 * 1000, 5);

/** Payment claim/verify — tight, per user. */
export const paymentActionLimiter = userLimiter('payment-action', 60 * 1000, 10);
