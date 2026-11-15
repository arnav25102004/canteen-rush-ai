import { describe, it, expect, vi, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { globalErrorHandler } from './errorHandler';
import { AppError } from '../utils/errors';

function run(err: unknown) {
  const res = { statusCode: 0, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  globalErrorHandler(err, { path: '/x' } as never, res as never, vi.fn());
  return res;
}
const known = (code: string) => new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'x' });

describe('globalErrorHandler', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('maps Prisma P2002 and P2025', () => {
    expect(run(known('P2002'))).toMatchObject({ statusCode: 409, body: { error: 'Already exists' } });
    expect(run(known('P2025'))).toMatchObject({ statusCode: 404, body: { error: 'Not found' } });
  });
  it('maps Prisma validation errors to 400', () => {
    expect(run(new Prisma.PrismaClientValidationError('secret schema detail', { clientVersion: 'x' })))
      .toMatchObject({ statusCode: 400, body: { error: 'Invalid request' } });
  });
  it('exposes AppError messages', () => {
    expect(run(new AppError(400, 'This time slot is full'))).toMatchObject({ statusCode: 400, body: { error: 'This time slot is full' } });
  });
  it('hides 5xx details unless NODE_ENV=development', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(run(new Error('SELECT * leaked'))).toMatchObject({ statusCode: 500, body: { error: 'Internal Server Error' } });
    vi.stubEnv('NODE_ENV', 'development');
    expect(run(new Error('detail')).body).toEqual({ error: 'detail' });
  });
});
