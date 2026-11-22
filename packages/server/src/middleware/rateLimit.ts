import rateLimit, { ClientRateLimitInfo, MemoryStore, Options, Store } from 'express-rate-limit';
import { isIPv6 } from 'net';
import { Request } from 'express';
import { AuthRequest } from './auth';
import { redis, redisEnabled } from '../config/redis';
import { redisBreakerOpen, tripRedisBreaker } from '../config/redisBreaker';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

/**
 * Rate limiting notes for this deployment:
 *
 * Students use campus WiFi (NAT) and mobile hotspots (carrier CGNAT), so
 * thousands of real users can share one public IP. IP limits here are therefore
 * deliberately coarse and act only as a DoS guard.
 *
 * Meaningful per-actor limits are keyed on the authenticated user id instead
 * (`userLimiter`), and must be mounted AFTER `authenticate` so req.user exists.
 *
 * Counters live in Redis so the limit holds across instances. If Redis is down
 * each instance falls back to its own memory: limits stay on, only less exact.
 */

const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}`;

class FailoverStore implements Store {
  private readonly memory = new MemoryStore();
  private windowMs = 60_000;

  constructor(private readonly name: string) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  private key(k: string) { return `rl:${this.name}:${k}`; }
  private useRedis() { return redisEnabled && redis.status === 'ready' && !redisBreakerOpen(); }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (this.useRedis()) {
      try {
        const [totalHits, ttl] = (await redis.eval(INCREMENT, 1, this.key(key), this.windowMs)) as [number, number];
        return { totalHits, resetTime: new Date(Date.now() + ttl) };
      } catch {
        tripRedisBreaker();
        metrics.inc('rate_limit_store_failures_total');
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string) {
    if (this.useRedis()) {
      try { await redis.decr(this.key(key)); return; } catch { /* fall through */ }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string) {
    if (this.useRedis()) {
      try { await redis.del(this.key(key)); } catch { /* fall through */ }
    }
    await this.memory.resetKey(key);
  }
}

/** IPv4 as is; IPv6 by /64, since one phone or hotspot controls a whole /64. */
export function ipKey(ip?: string): string {
  if (!ip) return 'unknown';
  const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!isIPv6(plain)) return plain;
  const [head, tail = ''] = plain.split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = plain.includes('::')
    ? [...left, ...new Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${full.slice(0, 4).map((p) => parseInt(p, 16).toString(16)).join(':')}::/64`;
}

function build(name: string, opts: Partial<Options> & Pick<Options, 'windowMs' | 'max'>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    store: new FailoverStore(name),
    keyGenerator: (req: Request) => ipKey(req.ip),
    handler: (req, res) => {
      metrics.inc('rate_limited_total', { limiter: name });
      logger.warn('Rate limit hit', {
        limiter: name,
        ip: req.ip,
        userId: (req as AuthRequest).user?.id,
        path: req.path,
      });
      res.setHeader('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
    },
    ...opts,
  });
}

/**
 * Coarse per-IP ceiling. Sized for campus NAT and carrier CGNAT, not per-user fairness.
 * ponytail: counted per instance, because a Redis round trip on every request would
 * cost more than serving a cached menu. Real ceiling = max x instances; put a
 * CDN/WAF rule in front for a strict global IP limit.
 */
export const GLOBAL_IP_MAX_PER_MIN = 6000;
export const globalLimiter = build('global', {
  windowMs: 60 * 1000,
  max: GLOBAL_IP_MAX_PER_MIN,
  store: new MemoryStore(),
});

/**
 * Credential endpoints. Still per-IP because there is no authenticated user
 * yet, but generous enough for a whole campus opening the app at lunch.
 * Firebase verifies the token, so there is no password to brute force here.
 */
export const AUTH_IP_MAX = 3000;
export const authLimiter = build('auth', {
  windowMs: 15 * 60 * 1000,
  max: AUTH_IP_MAX,
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
    keyGenerator: (req: Request) => (req as AuthRequest).user?.id ?? ipKey(req.ip),
  });
}

/** Every authenticated request, per user. Applied by `authenticate`. */
export const userApiLimiter = userLimiter('user-api', 60 * 1000, 300);

/** Placing orders is the expensive, money-adjacent path — tight, per user. */
export const placeOrderLimiter = userLimiter('place-order', 60 * 1000, 5);

/** Payment claim/verify — tight, per user. */
export const paymentActionLimiter = userLimiter('payment-action', 60 * 1000, 10);
