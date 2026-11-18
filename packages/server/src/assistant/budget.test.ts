import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), executeRaw: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() }));
vi.mock('../config/database', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    assistantDailyUsage: { updateMany: mocks.updateMany, findMany: mocks.findMany },
  },
}));

import { giveBackTurn, recordTokens, reserveTurn, MAX_TURNS_PER_USER } from './budget';
import { loadAssistantConfig } from './config';

const cfg = loadAssistantConfig({} as NodeJS.ProcessEnv);

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.executeRaw.mockResolvedValue(1);
});

describe('reserveTurn', () => {
  it('reserves the user row then the global row with one atomic conditional upsert each', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ tokens: 100 }]).mockResolvedValueOnce([{ tokens: 900 }]);
    const r = await reserveTurn('u1', cfg);
    expect(r).toEqual({ ok: true, userTokensToday: 100, globalTokensToday: 900 });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    const sql = mocks.queryRaw.mock.calls[0][0];
    expect(sql.sql).toMatch(/INSERT INTO\s+assistant_daily_usage/);
    expect(sql.sql).toMatch(/ON CONFLICT \(scope, day\) DO UPDATE SET turns = assistant_daily_usage\.turns \+ 1/);
    expect(sql.sql).toMatch(/WHERE assistant_daily_usage\.turns < .* AND assistant_daily_usage\.tokens < .*RETURNING tokens/s);
    expect(sql.values).toContain('u1');
    expect(sql.values).toContain(MAX_TURNS_PER_USER);
    expect(sql.values).toContain(cfg.userDailyTokens);
  });

  it('refuses when the user row is at its cap (no row returned)', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await reserveTurn('u1', cfg)).toEqual({ ok: false, reason: 'user_limit' });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses and gives the user turn back when the global budget is spent', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ tokens: 1 }]).mockResolvedValueOnce([]);
    expect(await reserveTurn('u1', cfg)).toEqual({ ok: false, reason: 'global_limit' });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ scope: { in: ['u1'] }, turns: { gt: 0 } }) }));
  });

  it('fails CLOSED on any error', async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error('db down'));
    expect(await reserveTurn('u1', cfg)).toEqual({ ok: false, reason: 'error' });
    mocks.queryRaw.mockResolvedValueOnce([{ tokens: 1 }]).mockRejectedValueOnce(new Error('db down'));
    expect(await reserveTurn('u1', cfg)).toEqual({ ok: false, reason: 'error' });
  });

  it('never lets more than the cap through when the DB serialises racing calls', async () => {
    // Model the row: the conditional upsert admits a call only while turns < cap.
    let turns = 0;
    mocks.queryRaw.mockImplementation(async (sql: { values: unknown[] }) => {
      if (sql.values.includes('global')) return [{ tokens: 0 }];
      if (turns < MAX_TURNS_PER_USER) {
        turns++;
        return [{ tokens: 0 }];
      }
      return [];
    });
    const results = await Promise.all(Array.from({ length: 50 }, () => reserveTurn('u1', cfg)));
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_TURNS_PER_USER);
  });
});

describe('recordTokens and giveBackTurn', () => {
  it('writes user, global and model rows in one multi-row upsert', async () => {
    await recordTokens('u1', 'm/x', 321);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const sql = mocks.executeRaw.mock.calls[0][0];
    expect(sql.values).toEqual(expect.arrayContaining(['u1', 'global', 'model:m/x', 321]));
    expect(sql.sql).toMatch(/ON CONFLICT \(scope, day\) DO UPDATE SET tokens = assistant_daily_usage\.tokens \+ EXCLUDED\.tokens/);
  });

  it('skips zero tokens and never throws', async () => {
    await recordTokens('u1', 'm', 0);
    expect(mocks.executeRaw).not.toHaveBeenCalled();
    mocks.executeRaw.mockRejectedValueOnce(new Error('boom'));
    await expect(recordTokens('u1', 'm', 5)).resolves.toBeUndefined();
  });

  it('giveBackTurn decrements user and global only where turns > 0, and never throws', async () => {
    await giveBackTurn('u1');
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scope: { in: ['u1', 'global'] }, turns: { gt: 0 } }),
        data: { turns: { decrement: 1 } },
      }),
    );
    mocks.updateMany.mockRejectedValueOnce(new Error('x'));
    await expect(giveBackTurn('u1')).resolves.toBeUndefined();
  });
});
