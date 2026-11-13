import { Router as ExpressRouter, RequestHandler } from 'express';

/**
 * Express 4 ignores promises returned by handlers: a rejected async handler
 * becomes an unhandled rejection, which kills the Node process (a one-request
 * DoS). This Router forwards those rejections to next(err) instead, so they
 * reach globalErrorHandler. Remove when moving to Express 5, which does this natively.
 */
const wrap = (h: unknown) =>
  typeof h === 'function' && h.length < 4
    ? ((req, res, next) => {
        try {
          const out = (h as RequestHandler)(req, res, next) as unknown;
          if (out instanceof Promise) out.catch(next);
        } catch (err) {
          next(err);
        }
      }) as RequestHandler
    : h;

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'use'] as const;

export function Router(): ExpressRouter {
  const router = ExpressRouter();
  for (const m of METHODS) {
    const original = (router[m] as (...args: unknown[]) => unknown).bind(router);
    (router as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => original(...args.map(wrap));
  }
  return router;
}
