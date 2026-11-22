import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const userFind = vi.fn();
vi.mock('../config/database', () => ({
  prisma: { menuItem: { findMany: (...a: unknown[]) => findMany(...a) }, user: { findUnique: (...a: unknown[]) => userFind(...a) } },
}));

import { searchMenuGlobal } from './menu.controller';

function run(query: Record<string, unknown>, user?: { id: string; institutionId?: string }) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  return searchMenuGlobal({ query, user } as any, res).then(() => res);
}

describe('searchMenuGlobal', () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
    userFind.mockReset();
  });

  it('scopes to the logged-in user institution, active canteens and available items', async () => {
    const res = await run({ q: 'puff', institutionId: 'ignored' }, { id: 'u1', institutionId: 'inst-1' });
    expect(res.statusCode).toBe(200);
    const where = findMany.mock.calls[0][0].where;
    expect(where.isAvailable).toBe(true);
    expect(where.canteen).toEqual({ institutionId: 'inst-1', isActive: true });
  });

  it('uses ?institutionId= when unauthenticated', async () => {
    await run({ q: 'puff', institutionId: 'inst-2' });
    expect(findMany.mock.calls[0][0].where.canteen).toEqual({ institutionId: 'inst-2', isActive: true });
  });

  it('returns 400 when the institution is unknown', async () => {
    expect((await run({ q: 'puff' })).statusCode).toBe(400);
    userFind.mockResolvedValue({ institutionId: null });
    expect((await run({ q: 'puff' }, { id: 'u1' })).statusCode).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('still requires q', async () => {
    expect((await run({ institutionId: 'i' })).statusCode).toBe(400);
  });
});
