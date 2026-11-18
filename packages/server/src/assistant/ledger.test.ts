import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createMany: vi.fn() }));
vi.mock('../config/database', () => ({ prisma: { assistantCallLog: { createMany: mocks.createMany } } }));

import { TurnLedger, sha256 } from './ledger';

beforeEach(() => mocks.createMany.mockReset().mockResolvedValue({ count: 0 }));

describe('TurnLedger', () => {
  it('buffers rows and flushes them in one createMany', async () => {
    const l = new TurnLedger('u1', 'c1');
    l.llm({ model: 'm', status: 'ok', latencyMs: 120, promptTokens: 10, completionTokens: 5, toolsOffered: 4 });
    l.tool({ name: 'search_menu', status: 'ok', latencyMs: 30, args: '{"q":"puff"}', resultBytes: 512 });
    l.turn({ status: 'ok', latencyMs: 900, promptTokens: 10, completionTokens: 5, groundingDrops: 2 });
    expect(mocks.createMany).not.toHaveBeenCalled();
    await l.flush();
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    const data = mocks.createMany.mock.calls[0][0].data;
    expect(data.map((r: { kind: string }) => r.kind)).toEqual(['LLM', 'TOOL', 'TURN']);
    expect(data[1]).toMatchObject({ userId: 'u1', conversationId: 'c1', name: 'search_menu', resultBytes: 512, argsSha256: sha256('{"q":"puff"}') });
    expect(data[2].groundingDrops).toBe(2);
    await l.flush(); // empty buffer: no second write
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
  });

  it('stores only a hash of tool arguments, never the text', async () => {
    const l = new TurnLedger('u1');
    l.tool({ name: 't', status: 'ok', latencyMs: 1, args: 'secret order text' });
    await l.flush();
    expect(JSON.stringify(mocks.createMany.mock.calls[0][0])).not.toContain('secret order text');
  });

  it('never throws when the database fails', async () => {
    mocks.createMany.mockRejectedValueOnce(new Error('db down'));
    const l = new TurnLedger(null);
    l.turn({ status: 'ok', latencyMs: NaN });
    await expect(l.flush()).resolves.toBeUndefined();
    expect(l.snapshot()).toHaveLength(0);
  });
});
