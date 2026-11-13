import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

// Prisma errors a client can cause with a bad id or duplicate value.
const PRISMA_STATUS: Record<string, [number, string]> = {
  P2025: [404, 'Not found'],
  P2002: [409, 'Already exists'],
  P2003: [400, 'Invalid reference'],
  P2023: [400, 'Invalid id'],
};

export function globalErrorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && PRISMA_STATUS[err.code]) {
    const [status, error] = PRISMA_STATUS[err.code];
    return res.status(status).json({ error });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error('Unhandled request error', { path: req.path, err: err.stack || err });

  // Never leak internals (SQL, stack details) on 5xx in production.
  const expose = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({ error: expose ? err.message || 'Error' : 'Internal Server Error' });
}
