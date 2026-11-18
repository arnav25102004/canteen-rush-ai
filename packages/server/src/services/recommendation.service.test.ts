import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn() }));
vi.mock('../config/database', () => ({ prisma: { orderItem: { groupBy: m.groupBy }, menuItem: { findMany: m.findMany } } }));

import { getRecommendations } from './recommendation.service';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Name ${id}`, price: 20, isVeg: true, isJain: false, containsEgg: false, prepTimeMinutes: 5, canteenId: 'can-1', totalOrders: 3,
  canteen: { name: 'Christ Bakery' }, category: { name: 'Snacks', availableFrom: null, availableTo: null }, ...over,
});
const q = { userId: 'u1', institutionId: 'inst1', diet: 'veg', at: '12:30', limit: 5 };

beforeEach(() => {
  m.groupBy.mockReset();
  m.findMany.mockReset();
});

describe('getRecommendations', () => {
  it('puts the student\'s usual items first (by quantity), then popular, without duplicates', async () => {
    m.groupBy.mockResolvedValue([{ menuItemId: 'a' }, { menuItemId: 'b' }]);
    m.findMany
      .mockResolvedValueOnce([row('b'), row('a')]) // history lookup (any order)
      .mockResolvedValueOnce([row('a'), row('c'), row('d')]); // popular
    const out = await getRecommendations({ ...q, limit: 4 });
    expect(out.map((r) => [r.id, r.reason])).toEqual([['a', 'usual'], ['b', 'usual'], ['c', 'popular'], ['d', 'popular']]);
  });

  it('applies the shared visibility rules to history and to popular items', async () => {
    m.groupBy.mockResolvedValue([{ menuItemId: 'a' }]);
    m.findMany.mockResolvedValue([]);
    await getRecommendations({ ...q, canteenId: 'can-9' });
    const hist = m.findMany.mock.calls[0][0].where;
    expect(hist).toMatchObject({ isAvailable: true, canteen: { institutionId: 'inst1', isActive: true }, category: { isActive: true }, canteenId: 'can-9', isVeg: true, id: { in: ['a'] } });
    const pop = m.findMany.mock.calls[1][0];
    expect(pop.where).toMatchObject({ isAvailable: true, canteen: { institutionId: 'inst1', isActive: true }, isVeg: true });
    expect(pop.orderBy).toEqual([{ isPopular: 'desc' }, { totalOrders: 'desc' }]);
  });

  it('only counts the student\'s own non-cancelled, non-no-show orders of the last 90 days', async () => {
    m.groupBy.mockResolvedValue([]);
    m.findMany.mockResolvedValue([]);
    await getRecommendations(q);
    const where = m.groupBy.mock.calls[0][0].where.order;
    expect(where.userId).toBe('u1');
    expect(where.status).toEqual({ notIn: ['CANCELLED', 'NO_SHOW'] });
    const days = (Date.now() - where.createdAt.gte.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('drops items whose category window excludes the pickup time (also for popular)', async () => {
    m.groupBy.mockResolvedValue([{ menuItemId: 'a' }]);
    const breakfast = { name: 'Breakfast', availableFrom: '07:00', availableTo: '11:00' };
    m.findMany
      .mockResolvedValueOnce([row('a', { category: breakfast })])
      .mockResolvedValueOnce([row('b', { category: breakfast }), row('c')]);
    const out = await getRecommendations(q);
    expect(out.map((r) => r.id)).toEqual(['c']);
    m.groupBy.mockResolvedValue([]);
    m.findMany.mockResolvedValue([row('b', { category: breakfast })]);
    expect(await getRecommendations({ ...q, at: '08:00' })).toHaveLength(1);
  });

  it('stops at the limit without a second query when history fills it', async () => {
    m.groupBy.mockResolvedValue([{ menuItemId: 'a' }, { menuItemId: 'b' }]);
    m.findMany.mockResolvedValueOnce([row('a'), row('b')]);
    const out = await getRecommendations({ ...q, limit: 2 });
    expect(out).toHaveLength(2);
    expect(m.findMany).toHaveBeenCalledTimes(1);
  });

  it('skips the history lookup for a student with no orders and returns popular items', async () => {
    m.groupBy.mockResolvedValue([]);
    m.findMany.mockResolvedValue([row('p1'), row('p2')]);
    const out = await getRecommendations(q);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(out.every((r) => r.reason === 'popular')).toBe(true);
  });
});
