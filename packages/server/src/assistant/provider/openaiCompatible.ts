import { Provider, ProviderError, ProviderRequest, ProviderResponse, RateLimitInfo, ToolCall, ZERO_USAGE } from './types';

/** "2m59.56s", "7.66s", "120ms", "1h2m" -> milliseconds. Returns undefined if unparsable. */
export function parseDurationMs(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000); // bare seconds (retry-after)
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const n = parseFloat(m[1]);
    total += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
  }
  return matched ? Math.round(total) : undefined;
}

function num(v: string | null): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseRateLimitHeaders(h: Headers): RateLimitInfo | undefined {
  const info: RateLimitInfo = {
    remainingRequests: num(h.get('x-ratelimit-remaining-requests')),
    remainingTokens: num(h.get('x-ratelimit-remaining-tokens')),
    resetRequestsMs: parseDurationMs(h.get('x-ratelimit-reset-requests')),
    resetTokensMs: parseDurationMs(h.get('x-ratelimit-reset-tokens')),
  };
  return Object.values(info).some((v) => v !== undefined) ? info : undefined;
}

function parseRetryAfter(h: Headers): number | undefined {
  const raw = h.get('retry-after');
  if (!raw) return undefined;
  const secs = parseDurationMs(raw);
  if (secs !== undefined) return secs;
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** Minimal OpenAI-compatible chat client (Groq) on Node fetch. No SDK, no streaming. */
export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): Provider {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return {
    async chat(req: ProviderRequest): Promise<ProviderResponse> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: 0.2,
        stream: false,
      };
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
        body.tool_choice = req.toolChoice ?? 'auto';
      }
      if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: any) {
        clearTimeout(timer);
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          throw new ProviderError('timeout', `timed out after ${req.timeoutMs}ms`);
        }
        throw new ProviderError('network', 'network error');
      }

      try {
        const rateLimit = parseRateLimitHeaders(res.headers);
        if (!res.ok) {
          let code: string | undefined;
          try {
            const j: any = await res.json();
            code = j?.error?.code ?? j?.error?.type;
          } catch { /* body not JSON */ }
          const status = res.status;
          const retryAfterMs = parseRetryAfter(res.headers);
          if (status === 401 || status === 403) throw new ProviderError('auth', `auth failed (${status})`, { status });
          if (status === 429) throw new ProviderError('rate_limit', 'rate limited', { status, retryAfterMs, rateLimit });
          if (status >= 500) throw new ProviderError('server', `server error (${status})`, { status, retryAfterMs });
          if (code === 'tool_use_failed') throw new ProviderError('tool_use_failed', 'tool call could not be parsed', { status });
          throw new ProviderError('bad_request', `request rejected (${status}${code ? ` ${code}` : ''})`, { status });
        }

        let json: any;
        try {
          json = await res.json();
        } catch {
          throw new ProviderError('server', 'invalid JSON from provider', { status: res.status });
        }
        const choice = json?.choices?.[0];
        if (!choice) throw new ProviderError('server', 'no choices in provider response', { status: res.status });
        const msg = choice.message ?? {};
        const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
          ? msg.tool_calls
              .filter((c: any) => c?.function?.name)
              .map((c: any, i: number) => ({
                id: String(c.id ?? `call_${i}`),
                name: String(c.function.name),
                arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}),
              }))
          : [];
        const u = json.usage ?? {};
        const usage = u.total_tokens != null || u.prompt_tokens != null
          ? {
              promptTokens: Number(u.prompt_tokens) || 0,
              completionTokens: Number(u.completion_tokens) || 0,
              totalTokens: Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0),
            }
          : ZERO_USAGE;
        return {
          content: typeof msg.content === 'string' ? msg.content : null,
          toolCalls,
          usage,
          finishReason: choice.finish_reason ?? null,
          rateLimit,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
