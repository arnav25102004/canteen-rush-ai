export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model produced it. */
  arguments: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON schema (from z.toJSONSchema). */
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  timeoutMs: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Remaining quota reported by the provider headers (x-ratelimit-*). */
export interface RateLimitInfo {
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequestsMs?: number;
  resetTokensMs?: number;
}

export interface ProviderResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: string | null;
  rateLimit?: RateLimitInfo;
}

export type ProviderErrorKind =
  | 'rate_limit' // 429
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'auth' // 401 / 403
  | 'tool_use_failed' // provider could not parse the tool call
  | 'bad_request' // other 4xx
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly opts: { status?: number; retryAfterMs?: number; rateLimit?: RateLimitInfo; usage?: Usage } = {}
  ) {
    super(message);
    this.name = 'ProviderError';
  }
  get status() { return this.opts.status; }
  get retryAfterMs() { return this.opts.retryAfterMs; }
  get rateLimit() { return this.opts.rateLimit; }
}

export interface Provider {
  chat(req: ProviderRequest): Promise<ProviderResponse>;
}

/** Thrown when no model produced an answer. `reason` says why, no secrets. */
export class AssistantUnavailableError extends Error {
  constructor(
    public readonly reason: 'all_failed' | 'auth' | 'deadline' | 'no_models',
    public readonly attempts: Array<{ model: string; outcome: string }> = []
  ) {
    super(`assistant unavailable: ${reason}`);
    this.name = 'AssistantUnavailableError';
  }
}

export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
