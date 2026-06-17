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

// Helpers
export const KEYS = {
  slotAvailability: (slotId: string) => `slot:${slotId}:availability`,
  orderSeq: (date: string) => `order_seq:${date}`,
  menuAvailability: (canteenId: string) => `canteen:${canteenId}:menu_avail`,
  sessionUser: (uid: string) => `session:${uid}`,
};

export async function incrOrderSeq(date: string): Promise<number> {
  const key = KEYS.orderSeq(date);
  const seq = await redis.incr(key);
  // Expire at end of day (86400 seconds)
  await redis.expire(key, 86400);
  return seq;
}
