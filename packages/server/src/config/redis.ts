import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  connectTimeout: 5000,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 500, 2000);
  },
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

// Redis is an optional cache (production on Render runs without it). Every
// call goes through these helpers, which treat any Redis error as a cache miss.
export const KEYS = {
  slotAvailability: (slotId: string) => `slot:${slotId}:availability`,
};

export async function cacheGet(key: string): Promise<string | null> {
  try { return await redis.get(key); } catch { return null; }
}

export async function cacheSet(key: string, ttlSeconds: number, value: string): Promise<void> {
  try { await redis.setex(key, ttlSeconds, value); } catch { /* cache is best-effort */ }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  try { await redis.del(...keys); } catch { /* cache is best-effort */ }
}

/** Both cache entries for a slot (student view and faculty view). */
export function slotCacheKeys(slotId: string): string[] {
  return [KEYS.slotAvailability(slotId), `${KEYS.slotAvailability(slotId)}:faculty`];
}
