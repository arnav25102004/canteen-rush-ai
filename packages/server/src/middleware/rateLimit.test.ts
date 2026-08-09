import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { globalLimiter, authLimiter, placeOrderLimiter } from './rateLimit';
import type { AuthRequest } from './auth';

function appWith(limiter: express.RequestHandler, injectUser?: string) {
  const app = express();
  if (injectUser) {
    app.use((req, _res, next) => {
      (req as AuthRequest).user = { id: injectUser } as AuthRequest['user'];
      next();
    });
  }
  app.use(limiter);
  app.get('/', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('globalLimiter', () => {
  it('allows requests under the ceiling', async () => {
    const app = appWith(globalLimiter);
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });
});

describe('authLimiter', () => {
  it('rejects with 429 once the per-IP ceiling for credential endpoints is exceeded', async () => {
    const app = appWith(authLimiter);
    let last;
    for (let i = 0; i < 101; i++) {
      last = await request(app).get('/');
    }
    expect(last!.status).toBe(429);
    expect(last!.body).toEqual({ error: 'Too many requests. Please slow down.' });
  });
});

describe('placeOrderLimiter (per-user keying)', () => {
  it('tracks limits per authenticated user id, not per IP', async () => {
    const appUserA = appWith(placeOrderLimiter, 'user-a');
    const appUserB = appWith(placeOrderLimiter, 'user-b');

    // Exhaust user-a's 5/min budget.
    let lastA;
    for (let i = 0; i < 5; i++) {
      lastA = await request(appUserA).get('/');
      expect(lastA.status).toBe(200);
    }
    lastA = await request(appUserA).get('/');
    expect(lastA.status).toBe(429);

    // user-b, sharing the same in-memory store but a different key, is unaffected.
    const resB = await request(appUserB).get('/');
    expect(resB.status).toBe(200);
  });
});
