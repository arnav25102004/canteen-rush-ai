import { Provider, ProviderError, ProviderErrorKind, ProviderRequest, ProviderResponse, ToolCall, Usage } from './types';

/** One scripted outcome: a response to return or an error to throw. */
export type ScriptStep = ProviderResponse | ProviderError | ((req: ProviderRequest) => ProviderResponse | ProviderError);

export function usage(promptTokens: number, completionTokens: number): Usage {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

export function textReply(content: string, u: Usage = usage(100, 20)): ProviderResponse {
  return { content, toolCalls: [], usage: u, finishReason: 'stop' };
}

export function toolReply(calls: Array<{ name: string; args?: unknown; id?: string }>, u: Usage = usage(100, 20)): ProviderResponse {
  const toolCalls: ToolCall[] = calls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    name: c.name,
    arguments: JSON.stringify(c.args ?? {}),
  }));
  return { content: null, toolCalls, usage: u, finishReason: 'tool_calls' };
}

export function failure(kind: ProviderErrorKind, opts: { status?: number; retryAfterMs?: number } = {}): ProviderError {
  return new ProviderError(kind, `scripted ${kind}`, opts);
}

/**
 * Deterministic provider for tests. Steps are consumed in order, either from one
 * shared queue or from a per-model queue. Running out of steps throws so a test
 * that makes an unexpected extra call fails loudly.
 */
export class ScriptedProvider implements Provider {
  readonly calls: ProviderRequest[] = [];
  private shared: ScriptStep[] = [];
  private perModel = new Map<string, ScriptStep[]>();

  constructor(script: ScriptStep[] | Record<string, ScriptStep[]> = []) {
    if (Array.isArray(script)) this.shared = [...script];
    else for (const [m, steps] of Object.entries(script)) this.perModel.set(m, [...steps]);
  }

  push(step: ScriptStep, model?: string) {
    if (model) this.perModel.set(model, [...(this.perModel.get(model) ?? []), step]);
    else this.shared.push(step);
  }

  callsTo(model: string) {
    return this.calls.filter((c) => c.model === model);
  }

  async chat(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const queue = this.perModel.get(req.model) ?? this.shared;
    const step = queue.shift();
    if (!step) throw new Error(`ScriptedProvider: no scripted step left for ${req.model}`);
    const out = typeof step === 'function' ? step(req) : step;
    if (out instanceof ProviderError) throw out;
    return out;
  }
}
