import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn() }));
vi.mock('../config/database', () => ({ prisma: { $executeRaw: mocks.executeRaw, assistantCallLog: { createMany: vi.fn() } } }));

import { CAPTION_ITEMS, CAPTION_ORDER, MAX_TOOL_ROUNDS, runTurn } from './loop';
import { loadAssistantConfig } from './config';
import { CircuitBreaker } from './provider/breaker';
import { ModelGovernor } from './provider/modelGovernor';
import { failure, ScriptedProvider, textReply, toolReply, usage } from './provider/scripted';
import { AssistantUnavailableError } from './provider/types';
import { TurnLedger } from './ledger';
import { RefMap } from './refs';
import { createRegistry, defineTool } from './tools/registry';
import type { TurnContext } from './context';

const cfg = loadAssistantConfig({} as NodeJS.ProcessEnv);

const card = { type: 'order_proposal', proposalId: 'p1', canteen: { id: 'c', name: 'Christ Bakery' }, slot: null, items: [], subtotal: 40, expiresAt: '', warnings: [] } as const;
const itemsCard = { type: 'items', title: 'x', items: [] } as const;

const calls: string[] = [];
const registry = createRegistry([
  defineTool({ name: 'search_menu', description: 'search', args: z.object({ q: z.string().optional() }), async run() { calls.push('search_menu'); return { data: { cols: 'm,name,price', rows: [['m1', 'Veg Puff', 20]] } }; } }),
  defineTool({ name: 'find_slots', description: 'slots', args: z.object({}), async run() { calls.push('find_slots'); return { data: { cols: 's,start', rows: [['s1', '13:00']] } }; } }),
  defineTool({ name: 'empty_tool', description: 'empty', args: z.object({}), async run() { return { data: { rows: [], found: 0 } }; } }),
  defineTool({ name: 'propose_order', description: 'propose', terminal: true, args: z.object({}), async run() { calls.push('propose_order'); return { data: { total: 40 }, card: card as never, facts: ['Veg Puff'], followups: ['a', 'b', 'c'] }; } }),
  defineTool({ name: 'show_items', description: 'show', terminal: true, args: z.object({}), async run() { return { data: { shown: 1 }, card: itemsCard as never }; } }),
]);
const offer = (...names: string[]) => names.map((n) => registry.get(n)!);

function ctx(): TurnContext {
  return {
    userId: 'u1', institutionId: 'i1', institutionName: 'Christ', role: 'STUDENT' as never, diet: 'veg', conversationId: 'conv',
    refs: new RefMap(), now: new Date('2026-11-18T07:11:00Z'),
    canteens: [{ id: 'cid', ref: 'c1', name: 'Christ Bakery', openingTime: '07:30', closingTime: '20:00', isOpenNow: true }],
  };
}

function setup(script: ConstructorParameters<typeof ScriptedProvider>[0], t0 = 1_000_000) {
  let t = t0;
  const now = () => t;
  const breaker = new CircuitBreaker({ now });
  const governor = new ModelGovernor(breaker, now, () => '20261118');
  const provider = new ScriptedProvider(script);
  const ledger = new TurnLedger('u1');
  const deps = { provider, registry, ledger, cfg, governor, breaker, now, sleep: async () => undefined };
  return { provider, ledger, deps, advance: (ms: number) => { t += ms; } };
}

beforeEach(() => {
  calls.length = 0;
  mocks.executeRaw.mockReset();
  mocks.executeRaw.mockResolvedValue(1);
});

describe('runTurn', () => {
  it('builds [system, context, history (clipped, last 4), user] and answers directly when no tool is needed', async () => {
    const s = setup([textReply('Hi! What would you like?')]);
    const history = Array.from({ length: 6 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i} ${'x'.repeat(400)}` }));
    const r = await runTurn(s.deps, ctx(), history, 'hello', { tools: offer('search_menu') });
    expect(r.text).toBe('Hi! What would you like?');
    expect(s.provider.calls).toHaveLength(1);
    const msgs = s.provider.calls[0].messages;
    expect(msgs).toHaveLength(2 + 4 + 1);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toMatchObject({ role: 'user' });
    expect(msgs[1].content).toMatch(/^<context>/);
    expect(msgs[2].content!.length).toBeLessThanOrEqual(240);
    expect(msgs[2].content).toMatch(/^m2 /);
    expect(msgs[6]).toEqual({ role: 'user', content: 'hello' });
    expect(s.provider.calls[0].tools?.map((t) => t.name)).toEqual(['search_menu']);
  });

  it('a successful terminal tool ends the turn with no extra model call (fixed caption)', async () => {
    const s = setup([
      toolReply([{ name: 'search_menu', args: { q: 'puff' }, id: 'a' }, { name: 'find_slots', args: {}, id: 'b' }]), // parallel
      toolReply([{ name: 'propose_order', args: {}, id: 'c' }]),
      textReply('SHOULD NOT BE CALLED'),
    ]);
    const r = await runTurn(s.deps, ctx(), [], '2 veg puffs for 1pm', { tools: offer('search_menu', 'find_slots', 'propose_order') });
    expect(s.provider.calls).toHaveLength(2);
    expect(calls).toEqual(['search_menu', 'find_slots', 'propose_order']);
    expect(r).toMatchObject({ text: CAPTION_ORDER, terminal: true, toolsCalled: 3, rounds: 2, llmCalls: 2 });
    expect(r.cards).toEqual([card]);
    expect(r.followups).toEqual(['a', 'b']);
    expect(r.factSources).toContainEqual(['Veg Puff']);
  });

  it('uses the model text alongside a terminal tool when it gave any, and the items caption otherwise', async () => {
    const withText = setup([{ ...toolReply([{ name: 'propose_order' }]), content: 'Two puffs for you.' }]);
    expect((await runTurn(withText.deps, ctx(), [], 'x', { tools: offer('propose_order') })).text).toBe('Two puffs for you.');
    const items = setup([toolReply([{ name: 'show_items' }])]);
    expect((await runTurn(items.deps, ctx(), [], 'x', { tools: offer('show_items') })).text).toBe(CAPTION_ITEMS);
  });

  it('stops at the round cap and makes one final round that cannot call tools', async () => {
    const s = setup([
      toolReply([{ name: 'search_menu' }]),
      toolReply([{ name: 'search_menu' }]),
      toolReply([{ name: 'search_menu' }]),
      textReply('Found puffs.'),
    ]);
    const r = await runTurn(s.deps, ctx(), [], 'puffs', { tools: offer('search_menu') });
    expect(MAX_TOOL_ROUNDS).toBe(3);
    expect(s.provider.calls).toHaveLength(4);
    expect(s.provider.calls.slice(0, 3).every((c) => c.toolChoice === undefined)).toBe(true);
    expect(s.provider.calls[3].toolChoice).toBe('none');
    expect(r.text).toBe('Found puffs.');
    expect(r.toolsCalled).toBe(3);
  });

  it('ignores tool calls the model makes in the final round', async () => {
    const s = setup([toolReply([{ name: 'search_menu' }]), toolReply([{ name: 'search_menu' }]), toolReply([{ name: 'search_menu' }]), toolReply([{ name: 'search_menu' }])]);
    const r = await runTurn(s.deps, ctx(), [], 'puffs', { tools: offer('search_menu') });
    expect(calls).toHaveLength(3);
    expect(r.text).toBe('');
  });

  it('goes to the final no-tools round once the per-turn token cap is reached', async () => {
    const s = setup([toolReply([{ name: 'search_menu' }], usage(3500, 600)), textReply('Done.', usage(300, 20))]);
    const r = await runTurn(s.deps, ctx(), [], 'puffs', { tools: offer('search_menu') });
    expect(s.provider.calls).toHaveLength(2);
    expect(s.provider.calls[1].toolChoice).toBe('none');
    expect(r).toMatchObject({ text: 'Done.', capped: 'tokens' });
    expect(r.tokens.total).toBe(3500 + 600 + 320);
  });

  it('stops calling the model once the deadline has passed and returns what the tools found', async () => {
    const s = setup([]);
    s.provider.push((() => {
      s.advance(21_000);
      return toolReply([{ name: 'search_menu' }]);
    }) as never);
    const r = await runTurn(s.deps, ctx(), [], 'puffs', { tools: offer('search_menu') });
    expect(s.provider.calls).toHaveLength(1);
    expect(r).toMatchObject({ text: '', capped: 'deadline', toolsCalled: 1 });
  });

  it('strips <think> from the model text', async () => {
    const s = setup([textReply('<think>reasoning about puffs</think>Veg Puff is available.')]);
    const r = await runTurn(s.deps, ctx(), [], 'puff?', { tools: offer('search_menu') });
    expect(r.text).toBe('Veg Puff is available.');
  });

  it('reports when every tool came back empty or failed', async () => {
    const s = setup([toolReply([{ name: 'empty_tool' }, { name: 'nope' }]), textReply('Nothing found.')]);
    const r = await runTurn(s.deps, ctx(), [], 'biryani', { tools: offer('empty_tool') });
    expect(r.allToolsEmpty).toBe(true);
    // 'nope' was not offered this turn: it comes back as an error, never executed
    const toolMsgs = s.provider.calls[1].messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[1].content).toContain('tool not available now');
  });

  it('wraps tool results as data in tool messages and writes ledger rows without content', async () => {
    const s = setup([toolReply([{ name: 'search_menu', args: { q: 'puff' }, id: 'x1' }]), textReply('Found.')]);
    await runTurn(s.deps, ctx(), [], 'puff', { tools: offer('search_menu') });
    const tool = s.provider.calls[1].messages.find((m) => m.role === 'tool')!;
    expect(tool.tool_call_id).toBe('x1');
    expect(tool.content).toMatch(/^<data kind="tool_result" tool="search_menu">/);
    const rows = s.ledger.snapshot();
    expect(rows.filter((r) => r.kind === 'LLM')).toHaveLength(2);
    expect(rows.find((r) => r.kind === 'TOOL')).toMatchObject({ name: 'search_menu', status: 'ok' });
    expect(JSON.stringify(rows)).not.toContain('Veg Puff');
  });

  it('records tokens after every model call', async () => {
    const s = setup([toolReply([{ name: 'search_menu' }]), textReply('ok')]);
    await runTurn(s.deps, ctx(), [], 'puff', { tools: offer('search_menu') });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it('follows the governor model order and falls back when main fails', async () => {
    const s = setup([failure('server'), textReply('From fallback.')]);
    const r = await runTurn(s.deps, ctx(), [], 'hello', { tools: offer('search_menu') });
    expect(r.text).toBe('From fallback.');
    expect(s.provider.calls.map((c) => c.model)).toEqual([cfg.models.main, cfg.models.fallback]);
  });

  it('throws AssistantUnavailableError when every model fails on the first call', async () => {
    const s = setup([failure('server'), failure('server'), failure('server')]);
    await expect(runTurn(s.deps, ctx(), [], 'hello', { tools: offer('search_menu') })).rejects.toBeInstanceOf(AssistantUnavailableError);
  });

  it('keeps what the tools found when a later round cannot be served', async () => {
    const s = setup([toolReply([{ name: 'search_menu' }]), failure('server'), failure('server'), failure('server')]);
    const r = await runTurn(s.deps, ctx(), [], 'puffs', { tools: offer('search_menu') });
    expect(r).toMatchObject({ text: '', toolsCalled: 1 });
  });
});
