import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

// Prisma errors a client can cause with a bad id or duplicate value.
const PRISMA_STATUS: Record<string, [number, string]> = {
  P2025: [404, 'Not found'],
  P2002: [409, 'Already exists'],
  P2003: [400, 'Invalid reference'],
  P2023: [400, 'Invalid id'],
};

// Pool exhausted / transaction could not start: the request is safe to retry.
const PRISMA_BUSY = new Set(['P2024', 'P2028', 'P2034']);

export function globalErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Already answered (e.g. the request deadline fired): let Express close the connection.
  if (res.headersSent) return next(err);

  if (err instanceof Prisma.PrismaClientKnownRequestError && PRISMA_BUSY.has(err.code)) {
    logger.warn('Database busy', { path: req.path, code: err.code });
    res.setHeader('Retry-After', '2');
    return res.status(503).json({ error: 'Server is busy. Please retry shortly.', code: 'OVERLOADED' });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && PRISMA_STATUS[err.code]) {
    const [status, error] = PRISMA_STATUS[err.code];
    return res.status(status).json({ error });
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid request',
      code: 'VALIDATION',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra ?? {}) });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error('Unhandled request error', { path: req.path, err: err.stack || err });

  // Never leak internals (SQL, stack details) on 5xx in production.
  const expose = status < 500 || process.env.NODE_ENV === 'development';
  res.status(status).json({ error: expose ? err.message || 'Error' : 'Internal Server Error' });
}
