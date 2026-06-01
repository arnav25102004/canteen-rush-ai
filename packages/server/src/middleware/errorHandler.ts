import { Request, Response, NextFunction } from 'express';

export function globalErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ error: message });
}
