/** Normalised list of browser origins allowed by CORS (REST and Socket.IO). */
export function parseOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const clean = (v?: string) =>
    (v ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  const dev = env.NODE_ENV !== 'production' ? ['http://localhost:3000', 'http://localhost:8081'] : [];
  return [...new Set([...dev, ...clean(env.CORS_ORIGINS), ...clean(env.WEB_URL)])];
}

/** cors-style origin callback: no Origin header (mobile) passes; unknown origins are denied, never thrown. */
export function originChecker(allowed: string[]) {
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
    cb(null, !origin || allowed.includes(origin));
}
