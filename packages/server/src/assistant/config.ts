import { z } from 'zod';

export const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_MODELS = {
  main: 'openai/gpt-oss-120b',
  fallback: 'qwen/qwen3.8-27b',
  fast: 'openai/gpt-oss-20b',
} as const;
export const DEFAULT_USER_DAILY_TOKENS = 60_000;
export const DEFAULT_GLOBAL_DAILY_TOKENS = 150_000;

/** Free-plan style limits for one model. Any field may be omitted (= unknown). */
export const modelLimitsSchema = z.object({
  rpm: z.number().int().positive().optional(), // requests per minute
  tpm: z.number().int().positive().optional(), // tokens per minute
  rpd: z.number().int().positive().optional(), // requests per day
  tpd: z.number().int().positive().optional(), // tokens per day
});
export type ModelLimits = z.infer<typeof modelLimitsSchema>;
const limitsMapSchema = z.record(z.string(), modelLimitsSchema);

const posInt = z.coerce.number().int().positive();
const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
const optStr = z.preprocess((v) => { const t = trimmed(v); return t === '' ? undefined : t; }, z.string().optional());

const envSchema = z.object({
  ASSISTANT_ENABLED: z.preprocess((v) => trimmed(v) === 'true', z.boolean()),
  GROQ_API_KEY: optStr,
  ASSISTANT_BASE_URL: optStr,
  ASSISTANT_MODEL_MAIN: optStr,
  ASSISTANT_MODEL_FAST: optStr,
  ASSISTANT_MODEL_FALLBACK: optStr,
  ASSISTANT_MODEL_LIMITS: optStr,
  ASSISTANT_USER_DAILY_TOKENS: z.preprocess((v) => { const t = trimmed(v); return t === '' ? undefined : t; }, posInt.optional()),
  ASSISTANT_GLOBAL_DAILY_TOKENS: z.preprocess((v) => { const t = trimmed(v); return t === '' ? undefined : t; }, posInt.optional()),
  ASSISTANT_PILOT_EMAILS: optStr,
});

export interface AssistantConfig {
  enabledFlag: boolean;
  apiKey: string | null;
  baseUrl: string;
  models: { main: string; fallback: string; fast: string };
  /** Per-model overrides of the built-in free-plan limits (model id -> limits). */
  limits: Record<string, ModelLimits>;
  userDailyTokens: number;
  globalDailyTokens: number;
  /** Lower-cased emails allowed while piloting. Empty = everyone. */
  pilotEmails: string[];
  /** Names (never values) of settings that were malformed and replaced by defaults. */
  problems: string[];
}

/**
 * Parses the assistant env. Never throws: a malformed value falls back to its
 * default and is listed in `problems`, so a bad setting can't stop the server.
 */
export function loadAssistantConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  const problems: string[] = [];
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(envSchema.shape)) raw[key] = env[key];

  let parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // Drop only the offending keys and re-parse so one typo can't reset everything.
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      problems.push(key);
      raw[key] = undefined;
    }
    parsed = envSchema.safeParse(raw);
  }
  const e = parsed.success ? parsed.data : envSchema.parse({});

  let limits: Record<string, ModelLimits> = {};
  if (e.ASSISTANT_MODEL_LIMITS) {
    try {
      const r = limitsMapSchema.safeParse(JSON.parse(e.ASSISTANT_MODEL_LIMITS));
      if (r.success) limits = r.data;
      else problems.push('ASSISTANT_MODEL_LIMITS');
    } catch {
      problems.push('ASSISTANT_MODEL_LIMITS');
    }
  }

  let baseUrl = (e.ASSISTANT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    problems.push('ASSISTANT_BASE_URL');
    baseUrl = DEFAULT_BASE_URL;
  }

  return {
    enabledFlag: e.ASSISTANT_ENABLED,
    apiKey: e.GROQ_API_KEY ?? null,
    baseUrl,
    models: {
      main: e.ASSISTANT_MODEL_MAIN ?? DEFAULT_MODELS.main,
      fallback: e.ASSISTANT_MODEL_FALLBACK ?? DEFAULT_MODELS.fallback,
      fast: e.ASSISTANT_MODEL_FAST ?? DEFAULT_MODELS.fast,
    },
    limits,
    userDailyTokens: e.ASSISTANT_USER_DAILY_TOKENS ?? DEFAULT_USER_DAILY_TOKENS,
    globalDailyTokens: e.ASSISTANT_GLOBAL_DAILY_TOKENS ?? DEFAULT_GLOBAL_DAILY_TOKENS,
    pilotEmails: (e.ASSISTANT_PILOT_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    problems: [...new Set(problems)],
  };
}

/** Why the assistant is off, or null when it is on. Names no secrets. */
export function assistantDisabledReason(cfg: AssistantConfig = loadAssistantConfig()): 'disabled' | 'no_api_key' | null {
  if (!cfg.enabledFlag) return 'disabled';
  if (!cfg.apiKey) return 'no_api_key';
  return null;
}

/** Pilot gate: empty list means everyone. */
export function isPilotAllowed(email: string | undefined, cfg: AssistantConfig = loadAssistantConfig()): boolean {
  if (cfg.pilotEmails.length === 0) return true;
  return !!email && cfg.pilotEmails.includes(email.trim().toLowerCase());
}
