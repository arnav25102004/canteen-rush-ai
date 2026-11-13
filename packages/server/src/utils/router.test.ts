import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from './router';

describe('Router (async error forwarding)', () => {
  it('sends async handler rejections to the error handler instead of crashing', async () => {
    const router = Router();
    router.get('/boom', async () => { throw new Error('db exploded'); });
    const app = express();
    app.use(router);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ caught: err.message });
    });

    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ caught: 'db exploded' });
  });
});
