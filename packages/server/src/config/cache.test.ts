import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('./redis', () => ({ redis: { status: 'end' }, redisEnabled: false }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { cached, invalidate, resetCacheForTests, writeThrough } from './cache';

const opts = { ttl: 60, stale: 300 };

describe('cache', () => {
  beforeEach(() => {
    process.env.CACHE_TEST = '1';
    resetCacheForTests();
    vi.useRealTimers();
  });
  afterAll(() => { delete process.env.CACHE_TEST; });

  it('serves repeat reads from cache', async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    await cached('a', load, opts);
    expect(await cached('a', load, opts)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('runs one DB load for concurrent misses', async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    await Promise.all(Array.from({ length: 50 }, () => cached('b', load, opts)));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('write-through makes the new value visible at once', async () => {
    await cached('c', async () => ({ inStock: true }), opts);
    await writeThrough('c', async () => ({ inStock: false }), opts);
    const load = vi.fn(async () => ({ inStock: true }));
    expect(await cached('c', load, opts)).toEqual({ inStock: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('a slow read cannot overwrite a newer write', async () => {
    let finishRead!: (v: { v: string }) => void;
    const slowRead = cached('d', () => new Promise<{ v: string }>((r) => { finishRead = r; }), opts);
    await new Promise((r) => setTimeout(r, 0));
    await writeThrough('d', async () => ({ v: 'new' }), opts);
    finishRead({ v: 'old' });
    await slowRead;
    expect(await cached('d', async () => ({ v: 'reload' }), opts)).toEqual({ v: 'new' });
  });

  it('serves the stale value when the DB is down', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await cached('e', async () => ({ v: 1 }), opts);
    vi.setSystemTime(1_000_000 + 61_000);
    expect(await cached('e', async () => { throw new Error('db down'); }, opts)).toEqual({ v: 1 });
  });

  it('never serves stale data for entries with no stale window', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await cached('f', async () => ({ banned: false }), { ttl: 30, stale: 0 });
    vi.setSystemTime(1_000_000 + 31_000);
    await expect(cached('f', async () => { throw new Error('db down'); }, { ttl: 30, stale: 0 })).rejects.toThrow('db down');
  });

  it('does not cache rejected values and reloads after invalidate', async () => {
    const load = vi.fn(async () => ({ categories: [] as string[] }));
    const o = { ...opts, cacheIf: (m: { categories: string[] }) => m.categories.length > 0 };
    await cached('g', load, o);
    await cached('g', load, o);
    expect(load).toHaveBeenCalledTimes(2);
    const keep = vi.fn(async () => ({ v: 1 }));
    await cached('h', keep, opts);
    await invalidate('h');
    await cached('h', keep, opts);
    expect(keep).toHaveBeenCalledTimes(2);
  });
});
