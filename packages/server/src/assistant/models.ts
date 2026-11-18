import { AssistantConfig, ModelLimits } from './config';

export type ModelRole = 'main' | 'fallback' | 'fast' | 'unknown';

export interface ModelSpec {
  id: string;
  role: ModelRole;
  maxTokens: number;
  tools: boolean;
  reasoningEffort?: 'low';
  /** Strip <think>...</think> from the reply (reasoning models that inline it). */
  stripThink: boolean;
  limits: ModelLimits;
}

/**
 * Built-in free-plan limits per Groq model. These are assumptions: CHECK THEM
 * against the Groq console before launch, and override with ASSISTANT_MODEL_LIMITS.
 */
const DEFAULT_LIMITS: Record<string, ModelLimits> = {
  'openai/gpt-oss-120b': { rpm: 30, tpm: 8_000, rpd: 1_000, tpd: 200_000 },
  'openai/gpt-oss-20b': { rpm: 30, tpm: 8_000, rpd: 1_000, tpd: 200_000 },
  'qwen/qwen3.8-27b': { rpm: 60, tpm: 6_000, rpd: 1_000, tpd: 500_000 },
};

const ROLE_SPEC: Record<Exclude<ModelRole, 'unknown'>, Omit<ModelSpec, 'id' | 'role' | 'limits'>> = {
  main: { maxTokens: 384, tools: true, reasoningEffort: 'low', stripThink: false },
  fallback: { maxTokens: 320, tools: true, stripThink: true },
  fast: { maxTokens: 320, tools: true, reasoningEffort: 'low', stripThink: false },
};

/** A model id we have no profile for: small output, no tools. */
export const UNKNOWN_MODEL_MAX_TOKENS = 256;

/**
 * Builds the spec for a configured model id. A configured id keeps its role
 * profile; an id that is not one of the three configured roles is "unknown".
 */
export function modelSpecFor(id: string, cfg: AssistantConfig): ModelSpec {
  const limits = { ...(DEFAULT_LIMITS[id] ?? {}), ...(cfg.limits[id] ?? {}) };
  const role = (['main', 'fallback', 'fast'] as const).find((r) => cfg.models[r] === id);
  if (!role) {
    return { id, role: 'unknown', maxTokens: UNKNOWN_MODEL_MAX_TOKENS, tools: false, stripThink: true, limits };
  }
  return { id, role, ...ROLE_SPEC[role], limits };
}

/** Specs in the normal order: main, fallback, fast (duplicates by id removed). */
export function configuredModels(cfg: AssistantConfig): ModelSpec[] {
  const seen = new Set<string>();
  const out: ModelSpec[] = [];
  for (const role of ['main', 'fallback', 'fast'] as const) {
    const id = cfg.models[role];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(modelSpecFor(id, cfg));
  }
  return out;
}

export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}
