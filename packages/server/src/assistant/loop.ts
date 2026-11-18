import { AssistantCard } from './cards';
import { AssistantConfig } from './config';
import { TurnContext } from './context';
import { TurnLedger } from './ledger';
import { buildContextMessage, SYSTEM_PROMPT } from './prompt';
import { callModel } from './provider/callModel';
import { CircuitBreaker } from './provider/breaker';
import { ModelGovernor } from './provider/modelGovernor';
import { AssistantUnavailableError, ChatMessage, Provider } from './provider/types';
import { executeTool, toProviderTools, ToolDefinition, ToolOutcome, ToolRegistry, wrapToolResult } from './tools/registry';

export const MAX_TOOL_ROUNDS = 3;
export const MAX_PARALLEL_TOOL_CALLS = 4;
export const TURN_TOKEN_CAP = 4000;
export const TURN_DEADLINE_MS = 20_000;
export const HISTORY_MESSAGES = 4;
export const HISTORY_CLIP_CHARS = 240;

export const CAPTION_ORDER = "Here's your order, review it and checkout.";
export const CAPTION_ITEMS = 'Here are some options:';

export function captionFor(card: AssistantCard): string {
  return card.type === 'order_proposal' ? CAPTION_ORDER : CAPTION_ITEMS;
}

export interface LoopDeps {
  provider: Provider;
  registry: ToolRegistry;
  ledger?: TurnLedger;
  cfg?: AssistantConfig;
  governor?: ModelGovernor;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface LoopOptions {
  /** The tools to offer (from the router). Defaults to none. */
  tools?: ToolDefinition[];
  userTokensToday?: number;
  globalTokensToday?: number;
  tokenCap?: number;
  deadlineMs?: number;
}

export interface TurnResult {
  /** The model's text, or the fixed caption after a terminal tool. May be empty. */
  text: string;
  cards: AssistantCard[];
  followups: string[];
  /** Raw tool data plus card facts: the only things the reply may state (grounding). */
  factSources: unknown[];
  toolsCalled: number;
  /** Tools were called and every one came back empty or failed. */
  allToolsEmpty: boolean;
  terminal: boolean;
  capped: 'tokens' | 'deadline' | null;
  rounds: number;
  llmCalls: number;
  tokens: { prompt: number; completion: number; total: number };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function isEmptyData(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const o = d as { found?: unknown; rows?: unknown };
  return o.found === 0 || (Array.isArray(o.rows) && o.rows.length === 0);
}

const estimate = (messages: ChatMessage[], tools: unknown) =>
  Math.ceil((JSON.stringify(messages).length + (tools ? JSON.stringify(tools).length : 0)) / 4);

/**
 * One assistant turn. messages = system prompt, context message, the last 4 history messages
 * (clipped; tool results are never replayed), then the new message. Up to 3 tool rounds, then
 * one final round that cannot call tools. A successful terminal tool (propose_order, show_items)
 * ends the turn with no further model call. The per-turn token cap and deadline skip ahead to the
 * final round. Throws AssistantUnavailableError only when no model call succeeded.
 */
export async function runTurn(
  deps: LoopDeps,
  ctx: TurnContext,
  history: ChatMessage[],
  userText: string,
  opts: LoopOptions = {},
): Promise<TurnResult> {
  const now = deps.now ?? (() => Date.now());
  const deadlineAt = now() + (opts.deadlineMs ?? TURN_DEADLINE_MS);
  const tokenCap = opts.tokenCap ?? TURN_TOKEN_CAP;
  const toolDefs = opts.tools && opts.tools.length > 0 ? toProviderTools(opts.tools) : undefined;
  const offered = new Set((opts.tools ?? []).map((t) => t.name));

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    buildContextMessage(ctx),
    ...history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: clip(m.content ?? '', HISTORY_CLIP_CHARS) })),
    { role: 'user', content: userText },
  ];

  const result: TurnResult = {
    text: '',
    cards: [],
    followups: [],
    factSources: [],
    toolsCalled: 0,
    allToolsEmpty: false,
    terminal: false,
    capped: null,
    rounds: 0,
    llmCalls: 0,
    tokens: { prompt: 0, completion: 0, total: 0 },
  };
  let toolRounds = 0;
  let emptyOrFailed = 0;

  for (;;) {
    const overTokens = result.tokens.total >= tokenCap;
    const overTime = now() >= deadlineAt;
    if ((overTokens || overTime) && !result.capped) result.capped = overTime ? 'deadline' : 'tokens';
    const final = toolRounds >= MAX_TOOL_ROUNDS || overTokens || overTime;
    // Out of time: no call at all. The caller falls back to the caption or a fixed template.
    if (overTime && result.llmCalls > 0) break;

    let call;
    try {
      call = await callModel(
        {
          messages,
          tools: toolDefs,
          toolChoice: final ? 'none' : undefined,
          userId: ctx.userId,
          userTokensToday: (opts.userTokensToday ?? 0) + result.tokens.total,
          globalTokensToday: (opts.globalTokensToday ?? 0) + result.tokens.total,
          estInputTokens: estimate(messages, toolDefs),
          deadlineAt,
        },
        { provider: deps.provider, ledger: deps.ledger, cfg: deps.cfg, governor: deps.governor, breaker: deps.breaker, sleep: deps.sleep, now: deps.now },
      );
    } catch (err) {
      // Later rounds that cannot be served still leave the student with what the tools found.
      if (err instanceof AssistantUnavailableError && result.llmCalls > 0) break;
      throw err;
    }
    result.llmCalls++;
    const res = call.response;
    result.tokens.prompt += res.usage.promptTokens;
    result.tokens.completion += res.usage.completionTokens;
    result.tokens.total += res.usage.totalTokens;

    if (final || res.toolCalls.length === 0) {
      result.text = (res.content ?? '').trim();
      break;
    }

    toolRounds++;
    result.rounds = toolRounds;
    messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });

    const run = res.toolCalls.slice(0, MAX_PARALLEL_TOOL_CALLS);
    const outcomes: ToolOutcome[] = await Promise.all(
      run.map((tc) =>
        offered.has(tc.name)
          ? executeTool(deps.registry, ctx, tc.name, tc.arguments)
          : Promise.resolve<ToolOutcome>({
              name: tc.name.slice(0, 40),
              ok: false,
              content: wrapToolResult(tc.name, { error: 'tool not available now' }),
              status: 'unknown_tool',
              terminal: false,
              latencyMs: 0,
              resultBytes: 0,
            }),
      ),
    );
    run.forEach((tc, i) => {
      const o = outcomes[i];
      deps.ledger?.tool({ name: o.name, status: o.status, latencyMs: o.latencyMs, args: tc.arguments, resultBytes: o.resultBytes });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: o.content });
    });
    for (const tc of res.toolCalls.slice(MAX_PARALLEL_TOOL_CALLS)) {
      messages.push({ role: 'tool', tool_call_id: tc.id, content: wrapToolResult(tc.name, { error: 'too many tool calls at once' }) });
    }

    result.toolsCalled += outcomes.length;
    for (const o of outcomes) {
      if (!o.ok || isEmptyData(o.data)) emptyOrFailed++;
      if (o.ok) {
        if (o.data !== undefined) result.factSources.push(o.data);
        if (o.facts) result.factSources.push(o.facts);
      }
    }

    const terminal = outcomes.find((o) => o.ok && o.terminal && o.card);
    if (terminal) {
      result.terminal = true;
      result.cards = [terminal.card!];
      result.followups = terminal.followups ?? [];
      result.text = (res.content ?? '').trim() || captionFor(terminal.card!);
      break;
    }
  }

  result.allToolsEmpty = result.toolsCalled > 0 && emptyOrFailed >= result.toolsCalled;
  return result;
}
