import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const baseSchema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: nonEmpty,
  JWT_SECRET: z.string().min(32),
});

const productionKeys = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;
const razorpayKeys = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const;

/**
 * Returns the names (never values) of invalid/missing env vars; empty = valid.
 * REDIS_URL is deliberately optional: every Redis call goes through the
 * best-effort cache helpers, so the app runs without it (slower, not broken).
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const base = baseSchema.safeParse(env);
  if (!base.success) {
    for (const issue of base.error.issues) problems.push(`${issue.path.join('.')} (${issue.code === 'too_small' ? 'too short' : 'missing/invalid'})`);
  }

  if (env.NODE_ENV === 'production') {
    const present = (k: string) => !!env[k]?.trim();
    for (const k of productionKeys) if (!present(k)) problems.push(`${k} (missing)`);
    if (!present('CORS_ORIGINS') && !present('WEB_URL')) problems.push('CORS_ORIGINS or WEB_URL (missing)');
    if (env.RAZORPAY_ENABLED === 'true') {
      for (const k of razorpayKeys) if (!present(k)) problems.push(`${k} (missing, required when RAZORPAY_ENABLED=true)`);
    }
    if (env.DEV_AUTH === 'true') problems.push('DEV_AUTH (must not be true in production)');
  }
  return problems;
}

/** Call once at boot. Logs key names only, then exits non-zero. */
export function assertEnv(): void {
  const problems = validateEnv();
  if (problems.length === 0) return;
  console.error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
