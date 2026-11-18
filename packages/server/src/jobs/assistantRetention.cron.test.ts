import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  msg: vi.fn(),
  prop: vi.fn(),
  log: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    assistantMessage: { deleteMany: mocks.msg },
    assistantProposal: { deleteMany: mocks.prop },
    assistantCallLog: { deleteMany: mocks.log },
  },
}));

import { purgeAssistantData } from './assistantRetention.cron';

describe('purgeAssistantData', () => {
  beforeEach(() => {
    mocks.msg.mockResolvedValue({ count: 3 });
    mocks.prop.mockResolvedValue({ count: 2 });
    mocks.log.mockResolvedValue({ count: 1 });
  });

  it('deletes messages after 30d, proposals after 7d and ledger after 90d', async () => {
    const now = new Date('2026-11-18T00:00:00Z');
    const res = await purgeAssistantData(now);
    const day = 86_400_000;
    expect(mocks.msg.mock.calls[0][0].where.createdAt.lt.getTime()).toBe(now.getTime() - 30 * day);
    expect(mocks.prop.mock.calls[0][0].where.createdAt.lt.getTime()).toBe(now.getTime() - 7 * day);
    expect(mocks.log.mock.calls[0][0].where.createdAt.lt.getTime()).toBe(now.getTime() - 90 * day);
    expect(res).toEqual({ messages: 3, proposals: 2, ledger: 1 });
  });
});
