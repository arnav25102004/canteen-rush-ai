import { randomUUID } from 'crypto';
import { monitorEventLoopDelay, performance } from 'perf_hooks';
import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

const MAX_IN_FLIGHT = Number(process.env.MAX_IN_FLIGHT) || 2000;
// Between these p99 event-loop delays, a growing share of non-critical requests is shed.
// Delay, not CPU use: a process at 100% CPU that still answers quickly is at its best throughput.
const SHED_FROM_LAG_MS = 200;
const SHED_FULL_LAG_MS = 800;
const SHED_MAX_SHARE = 0.8;
const LAG_RESOLUTION_MS = 10;
const SLOW_REQUEST_MS = 1000;
const LOG_SAMPLE_RATE = 0.01;
const REQUEST_DEADLINE_MS = 12_000;

let inFlight = 0;
let utilization = 0;
let lagMs = 0;
let lastElu = performance.eventLoopUtilization();
const lagMonitor = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
lagMonitor.enable();

setInterval(() => {
  const now = performance.eventLoopUtilization();
  utilization = performance.eventLoopUtilization(now, lastElu).utilization;
  lastElu = now;
  lagMs = Math.max(0, lagMonitor.percentile(99) / 1e6 - LAG_RESOLUTION_MS);
  lagMonitor.reset();
}, 500).unref();

metrics.gauge('http_in_flight', () => inFlight);
metrics.gauge('event_loop_utilization', () => utilization);
metrics.gauge('event_loop_lag_p99_ms', () => lagMs);

/** Request id, latency metric, and sampled access log (all errors and slow requests are kept). */
export function observe(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  const start = performance.now();
  res.once('finish', () => {
    const ms = performance.now() - start;
    metrics.observeLatency(ms);
    metrics.inc('http_requests_total', { class: `${Math.floor(res.statusCode / 100)}xx` });
    if (res.statusCode >= 500 || ms >= SLOW_REQUEST_MS || Math.random() < LOG_SAMPLE_RATE) {
      logger.info('request', { id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
    }
  });
  next();
}

// Money and order hand-over must still get through when the server is busy.
const isCritical = (req: Request) =>
  req.path.startsWith('/api/payments') || (req.method !== 'GET' && req.path.startsWith('/api/orders'));

/** Sheds non-critical work with a retryable 503 instead of letting latency grow without limit. */
export function shedLoad(req: Request, res: Response, next: NextFunction) {
  const share = Math.min(SHED_MAX_SHARE, (lagMs - SHED_FROM_LAG_MS) / (SHED_FULL_LAG_MS - SHED_FROM_LAG_MS));
  if (!isCritical(req) && (inFlight >= MAX_IN_FLIGHT || (share > 0 && Math.random() < share))) {
    metrics.inc('http_shed_total');
    res.setHeader('Retry-After', String(1 + Math.floor(Math.random() * 3)));
    return res.status(503).json({ error: 'Server is busy. Please retry shortly.', code: 'OVERLOADED' });
  }
  inFlight += 1;
  let done = false;
  const release = () => { if (!done) { done = true; inFlight -= 1; } };
  res.once('finish', release);
  res.once('close', release);
  next();
}

/**
 * Answers 503 if a handler hangs (e.g. the DB stops responding). The handler may
 * still finish later, so clients retry orders with the same clientRequestId.
 * Uploads and assistant turns are legitimately slower and are excluded.
 */
export function requestDeadline(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api/assistant') || req.path.endsWith('/image')) return next();
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    metrics.inc('http_deadline_exceeded_total');
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'Server is busy. Please retry shortly.', code: 'OVERLOADED' });
  }, REQUEST_DEADLINE_MS);
  timer.unref();
  const clear = () => clearTimeout(timer);
  res.once('finish', clear);
  res.once('close', clear);
  next();
}

/** Rejects if `work` takes longer than `ms`. The work itself is not cancelled. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
