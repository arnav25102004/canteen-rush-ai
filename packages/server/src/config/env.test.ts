import { describe, it, expect } from 'vitest';
import { validateEnv } from './env';
import { parseOrigins, originChecker } from './cors';

const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'a'.repeat(32) };
const prod = {
  ...base, NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'e', FIREBASE_PRIVATE_KEY: 'k',
  CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's',
  WEB_URL: 'https://app.example.com',
};

describe('validateEnv', () => {
  it('accepts a minimal dev env', () => expect(validateEnv(base)).toEqual([]));
  it('rejects missing DATABASE_URL and short JWT_SECRET by name only', () => {
    const out = validateEnv({ JWT_SECRET: 'short-secret-value' }).join(' ');
    expect(out).toContain('DATABASE_URL');
    expect(out).toContain('JWT_SECRET');
    expect(out).not.toContain('short-secret-value');
  });
  it('requires firebase, cloudinary and origins in production', () => {
    const out = validateEnv({ ...base, NODE_ENV: 'production' }).join(' ');
    for (const k of ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'CLOUDINARY_API_SECRET', 'CORS_ORIGINS or WEB_URL']) expect(out).toContain(k);
  });
  it('accepts a complete production env', () => expect(validateEnv(prod)).toEqual([]));
  it('requires razorpay keys only when enabled', () => {
    expect(validateEnv({ ...prod, RAZORPAY_ENABLED: 'false' })).toEqual([]);
    expect(validateEnv({ ...prod, RAZORPAY_ENABLED: 'true' }).join(' ')).toContain('RAZORPAY_WEBHOOK_SECRET');
  });
  it('forbids DEV_AUTH in production', () => {
    expect(validateEnv({ ...prod, DEV_AUTH: 'true' }).join(' ')).toContain('DEV_AUTH');
    expect(validateEnv({ ...base, DEV_AUTH: 'true' })).toEqual([]);
  });
});

describe('CORS origins', () => {
  it('includes localhost only outside production', () => {
    expect(parseOrigins({ NODE_ENV: 'development' })).toContain('http://localhost:3000');
    expect(parseOrigins({ NODE_ENV: 'production' })).not.toContain('http://localhost:3000');
  });
  it('normalises whitespace, trailing slashes and commas', () => {
    expect(parseOrigins({ NODE_ENV: 'production', CORS_ORIGINS: ' https://a.com/ , https://b.com ', WEB_URL: 'https://a.com/' }))
      .toEqual(['https://a.com', 'https://b.com']);
  });
  it('rejects unknown origins without throwing', () => {
    const check = originChecker(['https://a.com']);
    const results: Array<[Error | null, boolean | undefined]> = [];
    for (const o of [undefined, 'https://a.com', 'https://evil.com']) check(o, (e, a) => results.push([e, a]));
    expect(results).toEqual([[null, true], [null, true], [null, false]]);
  });
});
