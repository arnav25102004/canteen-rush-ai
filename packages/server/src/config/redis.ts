import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Without REDIS_URL the cache is disabled outright: no connection attempts, no
// reconnect log spam, every cache call is a miss and callers use the DB.
export const redisEnabled = !!process.env.REDIS_URL?.trim();

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1, // queued commands fail fast while disconnected (callers fall back to the DB)
  enableReadyCheck: false,
  connectTimeout: 5000,
  commandTimeout: 500, // a slow cache must never be slower than the DB it protects
  lazyConnect: true,
  enableAutoPipelining: true, // concurrent commands share one socket write
  // Never give up: Redis may come back at any time. Capped backoff.
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});

redis.on('error', (err) => {
  logger.error('Redis error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

