import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn(), createMany: vi.fn() }));
vi.mock('../../config/database', () => ({
  prisma: { $executeRaw: mocks.executeRaw, assistantCallLog: { createMany: mocks.createMany } },
}));

import { callModel } from './callModel';
import { CircuitBreaker } from './breaker';
import { ModelGovernor } from './modelGovernor';
import { failure, ScriptedProvider, textReply, toolReply, usage } from './scripted';
import { AssistantUnavailableError, ToolDef } from './types';
import { loadAssistantConfig } from '../config';
import { TurnLedger } from '../ledger';

const cfg = loadAssistantConfig({} as NodeJS.ProcessEnv);
const MAIN = cfg.models.main;
const FALLBACK = cfg.models.fallback;
const FAST = cfg.models.fast;
const tools: ToolDef[] = [{ name: 't', description: 'd', parameters: { type: 'object' } }];

function setup(script: ConstructorParameters<typeof ScriptedProvider>[0]) {
  let t = 1_000_000;
  const now = () => t;
  const brk = new CircuitBreaker({ now });
  const gov = new ModelGovernor(brk, now, () => '20261118');
  const provider = new ScriptedProvider(script);
  const ledger = new TurnLedger('u1');
  const sleep = vi.fn(async (ms: number) => {
    t += ms;
  });
  const run = (extra: Partial<Parameters<typeof callModel>[0]> = {}) =>
    callModel(
      { messages: [{ role: 'user', content: 'hi' }], tools, userId: 'u1', userTokensToday: 0, globalTokensToday: 0, estInputTokens: 500, ...extra },
      { provider, ledger, cfg, governor: gov, breaker: brk, sleep, now },
    );
  return {
    provider,
    gov,
    brk,
    ledger,
    sleep,
    run,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

beforeEach(() => {
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.createMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('callModel', () => {
  it('uses main first, records tokens on every call, strips think tags', async () => {
    const s = setup([textReply('<think>hmm</think>Hello', usage(100, 20))]);
    const r = await s.run();
    expect(r.model).toBe(MAIN);
    expect(r.response.content).toBe('Hello');
    expect(s.provider.calls[0].maxTokens).toBe(384);
    expect(s.provider.calls[0].reasoningEffort).toBe('low');
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(s.ledger.snapshot()[0]).toMatchObject({ kind: 'LLM', name: MAIN, status: 'ok', promptTokens: 100, completionTokens: 20, toolsOffered: 1 });
  });

  it('waits and retries the same model on a 429 with retry-after <= 1s', async () => {
    const s = setup({ [MAIN]: [failure('rate_limit', { status: 429, retryAfterMs: 800 }), textReply('ok')] });
    const r = await s.run();
    expect(r.model).toBe(MAIN);
    expect(s.sleep).toHaveBeenCalledWith(800);
    expect(s.provider.callsTo(MAIN)).toHaveLength(2);
    expect(s.provider.callsTo(FALLBACK)).toHaveLength(0);
  });

  it('cools the model down and falls back on a long retry-after, without waiting', async () => {
    const s = setup({ [MAIN]: [failure('rate_limit', { status: 429, retryAfterMs: 30_000 })], [FALLBACK]: [textReply('from fallback'), textReply('again')] });
    const r = await s.run();
    expect(r.model).toBe(FALLBACK);
    expect(s.sleep).not.toHaveBeenCalled();
    expect(s.gov.isCoolingDown(MAIN)).toBe(true);
    // rate limits are cooldowns, not breaker outages
    expect(s.brk.isOpen(MAIN)).toBe(false);
    expect(s.ledger.snapshot().map((x) => x.status)).toEqual(['rate_limited', 'ok']);
    // the cooled-down model is skipped on the next call
    const r2 = await s.run();
    expect(r2.model).toBe(FALLBACK);
    expect(s.provider.callsTo(MAIN)).toHaveLength(1);
  });

  it('a second short 429 after the wait goes to cooldown and the next model', async () => {
    const s = setup({
      [MAIN]: [failure('rate_limit', { retryAfterMs: 500 }), failure('rate_limit', { retryAfterMs: 500 })],
      [FALLBACK]: [textReply('x')],
    });
    const r = await s.run();
    expect(r.model).toBe(FALLBACK);
    expect(s.sleep).toHaveBeenCalledTimes(1);
  });

  it.each(['server', 'timeout', 'network'] as const)('falls back on %s', async (kind) => {
    const s = setup({ [MAIN]: [failure(kind, { status: 503 })], [FALLBACK]: [textReply('ok')] });
    const r = await s.run();
    expect(r.model).toBe(FALLBACK);
    expect(r.attempts).toEqual([{ model: MAIN, outcome: kind }]);
  });

  it('retries tool_use_failed exactly once on the same model', async () => {
    const s = setup({ [MAIN]: [failure('tool_use_failed'), toolReply([{ name: 't' }])] });
    const r = await s.run();
    expect(r.model).toBe(MAIN);
    expect(s.provider.callsTo(MAIN)).toHaveLength(2);

    const s2 = setup({ [MAIN]: [failure('tool_use_failed'), failure('tool_use_failed')], [FALLBACK]: [textReply('ok')] });
    const r2 = await s2.run();
    expect(s2.provider.callsTo(MAIN)).toHaveLength(2);
    expect(r2.model).toBe(FALLBACK);
    expect(s2.brk.isOpen(MAIN)).toBe(false);
  });

  it('a 401 stops the chain', async () => {
    const s = setup({ [MAIN]: [failure('auth', { status: 401 })], [FALLBACK]: [textReply('never')] });
    await expect(s.run()).rejects.toMatchObject({ name: 'AssistantUnavailableError', reason: 'auth' });
    expect(s.provider.callsTo(FALLBACK)).toHaveLength(0);
  });

  it('throws all_failed when every model fails, and records every attempt', async () => {
    const s = setup({
      [MAIN]: [failure('server')],
      [FALLBACK]: [failure('timeout')],
      [FAST]: [failure('network')],
    });
    const err = await s.run().catch((e) => e);
    expect(err).toBeInstanceOf(AssistantUnavailableError);
    expect(err.reason).toBe('all_failed');
    expect(err.attempts.map((a: { model: string }) => a.model)).toEqual([MAIN, FALLBACK, FAST]);
    expect(s.ledger.size).toBe(3);
  });

  it('opens the breaker after 3 outages in 60s, skips the model, then closes after 30s', async () => {
    const s = setup({
      [MAIN]: [failure('server'), failure('server'), failure('server'), textReply('main back')],
      [FALLBACK]: [textReply('a'), textReply('b'), textReply('c'), textReply('d')],
    });
    for (let i = 0; i < 3; i++) expect((await s.run()).model).toBe(FALLBACK);
    expect(s.brk.isOpen(MAIN)).toBe(true);
    const skipped = await s.run();
    expect(skipped.model).toBe(FALLBACK);
    expect(s.provider.callsTo(MAIN)).toHaveLength(3); // not called while open
    s.advance(30_001);
    expect(s.brk.isOpen(MAIN)).toBe(false);
    expect((await s.run()).model).toBe(MAIN);
  });

  it('a cooldown expires', async () => {
    const s = setup({ [MAIN]: [failure('rate_limit', { retryAfterMs: 5_000 }), textReply('main')], [FALLBACK]: [textReply('fb')] });
    expect((await s.run()).model).toBe(FALLBACK);
    s.advance(5_001);
    expect((await s.run()).model).toBe(MAIN);
  });

  it('passes the 10s call timeout and respects the turn deadline', async () => {
    const s = setup([textReply('ok')]);
    await s.run();
    expect(s.provider.calls[0].timeoutMs).toBe(10_000);

    const s2 = setup([textReply('ok')]);
    await s2.run({ deadlineAt: 1_000_000 + 4_000 });
    expect(s2.provider.calls[0].timeoutMs).toBe(4_000);

    const s3 = setup([textReply('ok')]);
    await expect(s3.run({ deadlineAt: 1_000_000 })).rejects.toMatchObject({ reason: 'deadline' });
  });

  it('only offers tools to models that support them and writes no budget row without a user', async () => {
    const s = setup([textReply('ok')]);
    await s.run({ userId: null, tools: undefined });
    expect(s.provider.calls[0].tools).toBeUndefined();
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it('throws no_models when nothing is usable', async () => {
    const s = setup([]);
    for (const m of [MAIN, FALLBACK, FAST]) s.gov.cooldown(m, 60_000);
    await expect(s.run()).rejects.toMatchObject({ reason: 'no_models' });
  });
});
