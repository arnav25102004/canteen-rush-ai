import { createHash, randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { redis, redisEnabled } from './redis';
import { redisBreakerOpen, tripRedisBreaker } from './redisBreaker';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';
import { withTimeout } from '../middleware/resilience';

/**
 * Two-level read cache with write-through.
 *
 *  L1: small in-process LRU, held for at most L1_MS so instances converge fast.
 *  L2: Redis, shared by every instance. Optional: without it L1 + DB still work.
 *
 * Reads: L1, then L2, then the DB (one load per key per process). A value past
 * its fresh time is served while a background refresh runs, and recently
 * requested keys are refreshed before they expire. If the DB is down, values
 * still inside their stale window keep being served.
 *
 * Writes: call writeThrough/invalidate AFTER the DB commit. A per-key generation
 * stops a slower read from overwriting newer data with what it loaded earlier.
 */

export interface CacheOptions<T = unknown> {
  /** Seconds a value counts as fresh. */
  ttl: number;
  /** Extra seconds it may be served while refreshing or while the DB is down. 0 = never. */
  stale?: number;
  /** Return false to skip caching this value (e.g. an empty result for an unknown id). */
  cacheIf?: (value: T) => boolean;
}

interface Entry {
  value: unknown;
  raw: string;
  freshUntil: number;
  staleUntil: number;
  l1Until: number;
}

interface Recent {
  load: () => Promise<unknown>;
  opts: CacheOptions<any>;
  at: number;
}

const L1_MS = 2_000;
const L1_MAX = 5_000;
const RECENT_MAX = 2_000;
const RECENT_WINDOW_MS = 10 * 60_000;
const REFRESH_AHEAD = 0.2; // refresh once less than 20% of the fresh time is left
const REFRESH_TICK_MS = 5_000;
const REFRESH_PER_TICK = 100;
const GEN_TTL_S = 86_400;
const DIRTY_MAX = 5_000;
const LOAD_TIMEOUT_MS = 2_500; // a hung DB must not hang a read that has a stale copy
const CHANNEL = 'cache:invalidate';
const INSTANCE = randomUUID();

const l1 = new Map<string, Entry>();
const flights = new Map<string, Promise<unknown>>();
const localGen = new Map<string, number>();
const recent = new Map<string, Recent>();
const dirty = new Set<string>(); // keys whose invalidation could not reach Redis
const bodies = new WeakMap<object, { json: string; gzip: Buffer; etag: string }>();

let subscriber: Redis | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

// Stores only write when the key's generation is still the one seen before the DB read.
const SET_IF_GEN = `
if (redis.call('GET', KEYS[2]) or '0') == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0`;

const disabled = () => !!process.env.VITEST && !process.env.CACHE_TEST;
const redisReady = () => redisEnabled && redis.status === 'ready' && !redisBreakerOpen();
const genKey = (key: string) => `cache:gen:${key}`;
const lockKey = (key: string) => `cache:lock:${key}`;
const dataKey = (key: string) => `cache:data:${key}`;
const bumpLocal = (key: string) => {
  if (localGen.size > L1_MAX * 2) localGen.clear();
  localGen.set(key, (localGen.get(key) ?? 0) + 1);
};

function remember(key: string, raw: string, freshUntil: number, staleUntil: number): Entry {
  const prev = l1.get(key);
  // Same bytes keep the same object, so its pre-compressed body stays valid.
  const value = prev && prev.raw === raw ? prev.value : JSON.parse(raw);
  const entry: Entry = { value, raw, freshUntil, staleUntil, l1Until: Date.now() + L1_MS };
  l1.delete(key);
  l1.set(key, entry);
  if (l1.size > L1_MAX) l1.delete(l1.keys().next().value as string);
  return entry;
}

async function readL2(key: string, opts: CacheOptions<any>): Promise<Entry | null> {
  if (!redisReady()) return null;
  try {
    const stored = await redis.get(dataKey(key));
    if (!stored) return null;
    const sep = stored.indexOf('|');
    const freshUntil = Number(stored.slice(0, sep));
    return remember(key, stored.slice(sep + 1), freshUntil, freshUntil + (opts.stale ?? 0) * 1000);
  } catch {
    tripRedisBreaker();
    return null;
  }
}

async function writeL2(key: string, raw: string, freshUntil: number, gen: string, opts: CacheOptions<any>) {
  if (!redisReady()) return;
  try {
    const seconds = opts.ttl + (opts.stale ?? 0);
    await redis.eval(SET_IF_GEN, 2, dataKey(key), genKey(key), gen, `${freshUntil}|${raw}`, seconds);
  } catch { tripRedisBreaker(); /* cache is best-effort */ }
}

async function readGen(key: string): Promise<string> {
  if (!redisReady()) return '0';
  try { return (await redis.get(genKey(key))) ?? '0'; } catch { tripRedisBreaker(); return '0'; }
}

async function bumpGen(key: string): Promise<string> {
  if (!redisReady()) { markDirty(key); return '0'; }
  try {
    const [[, gen]] = (await redis.multi().incr(genKey(key)).expire(genKey(key), GEN_TTL_S).exec()) as [[Error | null, number], unknown];
    return String(gen);
  } catch {
    tripRedisBreaker();
    markDirty(key);
    return '0';
  }
}

function markDirty(key: string) {
  if (!redisEnabled) return;
  if (dirty.size < DIRTY_MAX) dirty.add(key);
}

async function publish(key: string) {
  if (!redisReady()) return;
  try { await redis.publish(CHANNEL, `${INSTANCE}|${key}`); } catch { tripRedisBreaker(); /* peers fall back to L1_MS */ }
}

async function store<T>(key: string, value: T, gen: string, seenLocal: number, opts: CacheOptions<T>): Promise<T> {
  if (opts.cacheIf && !opts.cacheIf(value)) return value;
  const raw = JSON.stringify(value);
  const now = Date.now();
  const freshUntil = now + opts.ttl * 1000;
  // A write landed during this load: hand the caller the value, but do not store it.
  if ((localGen.get(key) ?? 0) !== seenLocal) return JSON.parse(raw);
  const entry = remember(key, raw, freshUntil, freshUntil + (opts.stale ?? 0) * 1000);
  await writeL2(key, raw, freshUntil, gen, opts);
  return entry.value as T;
}

function loadShared<T>(key: string, load: () => Promise<T>, opts: CacheOptions<T>): Promise<T> {
  const running = flights.get(key);
  if (running) return running as Promise<T>;
  const flight = (async () => {
    const seenLocal = localGen.get(key) ?? 0;
    const gen = await readGen(key);
    metrics.inc('cache_db_loads_total');
    return store(key, await load(), gen, seenLocal, opts);
  })().finally(() => flights.delete(key));
  flights.set(key, flight);
  return flight;
}

async function refresh<T>(key: string, load: () => Promise<T>, opts: CacheOptions<T>): Promise<void> {
  if (flights.has(key)) return;
  try {
    if (redisReady()) {
      // Only one instance refreshes a key at a time.
      const got = await redis.set(lockKey(key), '1', 'EX', 5, 'NX');
      if (!got) return;
    }
    await loadShared(key, load, opts);
    metrics.inc('cache_refreshes_total');
  } catch (err) {
    logger.warn('Cache refresh failed', { key, err: (err as Error)?.message });
  }
}

function track(key: string, load: () => Promise<unknown>, opts: CacheOptions<any>) {
  recent.delete(key);
  recent.set(key, { load, opts, at: Date.now() });
  if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
}

/** Read-through lookup. Throws only when the DB fails and no usable value exists. */
export async function cached<T>(key: string, load: () => Promise<T>, opts: CacheOptions<T>): Promise<T> {
  if (disabled()) return load();
  track(key, load, opts);

  const now = Date.now();
  const local = l1.get(key);
  // With Redis, L1 is a short window so instances converge. Without it, L1 is the only
  // cache and holds for the full TTL (running several instances requires Redis).
  if (local && now < local.freshUntil && (!redisEnabled || now < local.l1Until)) {
    metrics.inc('cache_hits_total', { level: 'l1' });
    return local.value as T;
  }
  if (!redisEnabled && local && now < local.staleUntil) {
    metrics.inc('cache_hits_total', { level: 'stale' });
    void refresh(key, load, opts);
    return local.value as T;
  }

  const remote = await readL2(key, opts);
  if (remote) {
    if (now < remote.freshUntil) {
      metrics.inc('cache_hits_total', { level: 'l2' });
      return remote.value as T;
    }
    if (now < remote.staleUntil) {
      metrics.inc('cache_hits_total', { level: 'stale' });
      void refresh(key, load, opts);
      return remote.value as T;
    }
  }

  metrics.inc('cache_misses_total');
  try {
    return await withTimeout(loadShared(key, load, opts), LOAD_TIMEOUT_MS, 'Cache load');
  } catch (err) {
    const fallback = l1.get(key);
    if (fallback && Date.now() < fallback.staleUntil) {
      metrics.inc('cache_hits_total', { level: 'db_down' });
      return fallback.value as T;
    }
    if (err instanceof Error && err.message.startsWith('Cache load timed out')) {
      throw Object.assign(err, { status: 503 });
    }
    throw err;
  }
}

/**
 * Write-through: reloads the committed row(s) and stores them now, so readers on
 * every instance see the change at once. Never throws: the DB write has already
 * succeeded, so a cache failure must not fail the caller's request.
 */
export async function writeThrough<T>(key: string, load: () => Promise<T>, opts: CacheOptions<T>): Promise<void> {
  if (disabled()) return;
  bumpLocal(key);
  l1.delete(key);
  try {
    const gen = await bumpGen(key);
    const seenLocal = localGen.get(key) ?? 0;
    const value = await load();
    if (opts.cacheIf && !opts.cacheIf(value)) await removeL2(key);
    else await store(key, value, gen, seenLocal, opts);
  } catch (err) {
    logger.warn('Cache write-through failed, invalidating', { key, err: (err as Error)?.message });
    await removeL2(key);
  }
  await publish(key);
}

async function removeL2(key: string) {
  if (!redisEnabled) return;
  if (!redisReady()) { markDirty(key); return; }
  try { await redis.del(dataKey(key)); } catch { tripRedisBreaker(); markDirty(key); }
}

/** Drops keys everywhere. The next read reloads from the DB. Never throws. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (disabled()) return;
  await Promise.all(keys.map(async (key) => {
    bumpLocal(key);
    l1.delete(key);
    recent.delete(key);
    await bumpGen(key);
    await removeL2(key);
    await publish(key);
  }));
}

async function refreshDueKeys() {
  if (dirty.size && redisReady()) await replayDirty();
  const now = Date.now();
  const due: Array<[string, Recent]> = [];
  for (const [key, r] of recent) {
    if (now - r.at > RECENT_WINDOW_MS) { recent.delete(key); continue; }
    if (!r.opts.stale) continue; // auth rows reload on demand; refreshing them is idle DB load
    const e = l1.get(key);
    const margin = r.opts.ttl * 1000 * REFRESH_AHEAD;
    if (!e || e.freshUntil - now <= margin) due.push([key, r]);
    if (due.length >= REFRESH_PER_TICK) break;
  }
  for (const [key, r] of due) {
    // Another instance may have refreshed it already.
    const remote = await readL2(key, r.opts);
    if (remote && remote.freshUntil - Date.now() > r.opts.ttl * 1000 * REFRESH_AHEAD) continue;
    await refresh(key, r.load, r.opts);
  }
}

/**
 * Applies writes that could not reach Redis. Keys with a stale window are reloaded
 * rather than deleted, so a DB outage right now cannot erase the copy it would need.
 * Keys with no stale window (auth) are always dropped.
 */
async function replayDirty() {
  const keys = [...dirty];
  dirty.clear();
  await Promise.all(keys.map(async (key) => {
    const r = recent.get(key);
    if (!r || !r.opts.stale) return invalidate(key);
    try {
      bumpLocal(key);
      const seenLocal = localGen.get(key) ?? 0;
      const gen = await bumpGen(key);
      const value = await withTimeout(r.load(), LOAD_TIMEOUT_MS, 'Cache reload');
      if (r.opts.cacheIf && !r.opts.cacheIf(value)) await removeL2(key);
      else await store(key, value, gen, seenLocal, r.opts);
      await publish(key);
    } catch {
      markDirty(key);
    }
  }));
}

/** Starts cross-instance invalidation and the refresh-ahead timer. */
export async function startCacheSync(): Promise<void> {
  if (disabled() || refreshTimer) return;
  refreshTimer = setInterval(() => void refreshDueKeys().catch(() => {}), REFRESH_TICK_MS);
  refreshTimer.unref();
  if (!redisEnabled) return;

  redis.on('ready', () => void replayDirty());
  subscriber = redis.duplicate({ lazyConnect: true, commandTimeout: undefined });
  subscriber.on('error', () => { /* reconnects on its own */ });
  subscriber.on('message', (_channel, message) => {
    const sep = message.indexOf('|');
    if (message.slice(0, sep) === INSTANCE) return;
    const key = message.slice(sep + 1);
    bumpLocal(key);
    l1.delete(key);
  });
  try {
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL);
  } catch {
    logger.warn('Cache invalidation channel unavailable; instances converge within the L1 window');
  }
}

export async function stopCacheSync(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (subscriber) subscriber.disconnect();
  subscriber = null;
}

/**
 * Sends a cached object using a pre-serialised, pre-gzipped body with an ETag,
 * so a cache hit costs no JSON or compression work.
 */
export function sendCachedJson(req: Request, res: Response, value: object, cacheControl?: string) {
  let body = bodies.get(value);
  if (!body) {
    const json = JSON.stringify(value);
    body = {
      json,
      gzip: gzipSync(json),
      etag: `"${createHash('sha1').update(json).digest('base64url')}"`,
    };
    bodies.set(value, body);
  }
  res.setHeader('ETag', body.etag);
  res.setHeader('Vary', 'Accept-Encoding');
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  if (req.headers['if-none-match'] === body.etag) return res.status(304).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(body.gzip);
  }
  return res.end(body.json);
}

/** Test helper: forget all in-process state. */
export function resetCacheForTests() {
  l1.clear();
  flights.clear();
  localGen.clear();
  recent.clear();
  dirty.clear();
}
