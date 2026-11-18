import { logger } from '../../utils/logger';
import { recordTokens } from '../budget';
import { AssistantConfig, loadAssistantConfig } from '../config';
import { TurnLedger } from '../ledger';
import { ModelSpec, stripThinkTags } from '../models';
import { breaker as defaultBreaker, CircuitBreaker } from './breaker';
import { governor as defaultGovernor, ModelGovernor } from './modelGovernor';
import { AssistantUnavailableError, ChatMessage, Provider, ProviderError, ProviderResponse, ToolDef } from './types';

export const CALL_TIMEOUT_MS = 10_000;
export const MAX_WAIT_FOR_RETRY_AFTER_MS = 1_000;

export interface CallModelInput {
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none';
  userId: string | null;
  userTokensToday: number;
  globalTokensToday: number;
  estInputTokens: number;
  /** Absolute epoch ms by which the whole turn must be done. */
  deadlineAt?: number;
}

export interface CallModelDeps {
  provider: Provider;
  ledger?: TurnLedger;
  cfg?: AssistantConfig;
  governor?: ModelGovernor;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CallModelResult {
  response: ProviderResponse;
  model: string;
  /** Models that were tried and failed before this one answered. */
  attempts: Array<{ model: string; outcome: string }>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Walks the governor's model order. Each model gets one try; we move on only when
 * no answer came back. Exceptions: a 429 with retry-after <= 1s waits and retries
 * once, and Groq's tool_use_failed gets one retry. Longer 429s put the model in
 * cooldown (we never wait long). Auth errors stop the chain.
 */
export async function callModel(input: CallModelInput, deps: CallModelDeps): Promise<CallModelResult> {
  const cfg = deps.cfg ?? loadAssistantConfig();
  const gov = deps.governor ?? defaultGovernor;
  const brk = deps.breaker ?? defaultBreaker;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const ledger = deps.ledger;

  const chain = gov.pickChain(
    {
      userTokensToday: input.userTokensToday,
      globalTokensToday: input.globalTokensToday,
      estInputTokens: input.estInputTokens,
      needTools: !!input.tools?.length,
    },
    cfg,
  );
  const attempts: Array<{ model: string; outcome: string }> = [];
  if (chain.length === 0) throw new AssistantUnavailableError('no_models', attempts);

  async function tryModel(spec: ModelSpec): Promise<ProviderResponse | null> {
    let toolRetryUsed = false;
    let waitRetryUsed = false;
    const offered = spec.tools ? input.tools : undefined;
    for (;;) {
      if (input.deadlineAt !== undefined && now() >= input.deadlineAt) {
        throw new AssistantUnavailableError('deadline', attempts);
      }
      const timeoutMs = input.deadlineAt !== undefined ? Math.min(CALL_TIMEOUT_MS, input.deadlineAt - now()) : CALL_TIMEOUT_MS;
      const started = now();
      try {
        const res = await deps.provider.chat({
          model: spec.id,
          messages: input.messages,
          tools: offered,
          toolChoice: offered ? input.toolChoice : undefined,
          maxTokens: spec.maxTokens,
          reasoningEffort: spec.reasoningEffort,
          timeoutMs,
        });
        const total = res.usage.totalTokens;
        gov.noteUsage(spec.id, total, res.rateLimit);
        brk.recordSuccess(spec.id);
        ledger?.llm({
          model: spec.id,
          status: 'ok',
          latencyMs: now() - started,
          promptTokens: res.usage.promptTokens,
          completionTokens: res.usage.completionTokens,
          toolsOffered: offered?.length ?? 0,
        });
        if (input.userId) await recordTokens(input.userId, spec.id, total);
        return { ...res, content: res.content == null ? null : stripThinkTags(res.content) };
      } catch (err) {
        if (err instanceof AssistantUnavailableError) throw err;
        const perr = err instanceof ProviderError ? err : null;
        const kind = perr?.kind ?? 'unknown';
        const status = kind === 'rate_limit' ? 'rate_limited' : kind === 'timeout' ? 'timeout' : kind === 'auth' ? 'auth' : 'error';
        ledger?.llm({ model: spec.id, status, latencyMs: now() - started, toolsOffered: offered?.length ?? 0 });
        if (!perr) logger.warn('assistant provider threw a non-provider error', { model: spec.id });

        if (kind === 'auth') {
          attempts.push({ model: spec.id, outcome: 'auth' });
          throw new AssistantUnavailableError('auth', attempts);
        }
        if (kind === 'tool_use_failed' && !toolRetryUsed) {
          toolRetryUsed = true;
          continue;
        }
        if (kind === 'rate_limit') {
          const ra = perr?.retryAfterMs;
          if (ra !== undefined && ra <= MAX_WAIT_FOR_RETRY_AFTER_MS && !waitRetryUsed) {
            waitRetryUsed = true;
            await sleep(ra);
            continue;
          }
          gov.cooldown(spec.id, ra ?? perr?.rateLimit?.resetRequestsMs ?? perr?.rateLimit?.resetTokensMs);
          if (perr?.rateLimit) gov.noteUsage(spec.id, 0, perr.rateLimit);
        } else if (kind === 'server' || kind === 'timeout' || kind === 'network' || kind === 'unknown') {
          brk.recordFailure(spec.id);
        }
        attempts.push({ model: spec.id, outcome: kind });
        return null;
      }
    }
  }

  for (const spec of chain) {
    const result = await tryModel(spec);
    if (result) return { response: result, model: spec.id, attempts };
  }
  throw new AssistantUnavailableError('all_failed', attempts);
}
