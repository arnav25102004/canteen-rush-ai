import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  canteenFindFirst: vi.fn(),
  menuItemFindMany: vi.fn(),
  searchMenuItems: vi.fn(),
  getCanteenMenuData: vi.fn(),
  listSlots: vi.fn(),
  quoteOrder: vi.fn(),
  assertNotStrikeBanned: vi.fn(),
  findRecent: vi.fn(),
  getLoyalty: vi.fn(),
  getRecs: vi.fn(),
  createProposal: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  prisma: { canteen: { findFirst: m.canteenFindFirst }, menuItem: { findMany: m.menuItemFindMany } },
}));
vi.mock('../../services/menu.service', async (orig) => ({
  ...(await orig<typeof import('../../services/menu.service')>()),
  searchMenuItems: m.searchMenuItems,
  getCanteenMenuData: m.getCanteenMenuData,
}));
vi.mock('../../services/slot.service', () => ({ listSlotsWithAvailability: m.listSlots }));
vi.mock('../../services/order.service', () => ({
  quoteOrder: m.quoteOrder,
  assertNotStrikeBanned: m.assertNotStrikeBanned,
  findRecentOrdersForUser: m.findRecent,
}));
vi.mock('../../services/loyalty.service', () => ({
  getLoyaltyAccount: m.getLoyalty,
  getRedemptionTiers: () => [
    { points: 200, discount: 20 },
    { points: 500, discount: 60 },
    { points: 1000, discount: 120 },
  ],
}));
vi.mock('../../services/recommendation.service', () => ({ getRecommendations: m.getRecs }));
vi.mock('../proposals', () => ({ createProposal: m.createProposal }));

import { AppError } from '../../utils/errors';
import { RefMap } from '../refs';
import { executeTool, ToolCtx } from './registry';
import { toolRegistry } from './index';

const NOW = new Date('2026-11-18T07:00:00.000Z'); // 12:30 IST
function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { userId: 'u1', institutionId: 'inst1', role: 'STUDENT' as never, diet: 'veg', conversationId: 'conv1', refs: new RefMap(), now: NOW, ...over };
}
const run = (c: ToolCtx, name: string, args: unknown) => executeTool(toolRegistry, c, name, JSON.stringify(args));
const body = (content: string) => JSON.parse(content.replace(/^<data[^>]*>/, '').replace(/<\/data>$/, ''));

const item = (i: number, over = {}) => ({
  id: `item-${i}`, name: `Item ${i}`, price: 10 * i, isVeg: true, isJain: false, containsEgg: false, prepTimeMinutes: 5,
  canteenId: 'can-1', canteenName: 'Christ Bakery', categoryName: 'Snacks', totalOrders: 1, ...over,
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
});

describe('search_menu', () => {
  it('uses the profile diet and institution, hides UUIDs, and returns compact rows', async () => {
    m.searchMenuItems.mockResolvedValue([item(1), item(2, { isVeg: false })]);
    const c = ctx();
    const r = await run(c, 'search_menu', { q: 'puff', maxPrice: 80, sort: 'price' });
    expect(m.searchMenuItems).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst1', diet: 'veg', text: 'puff', maxPrice: 80, sort: 'price_asc', limit: 8, at: '12:30' }));
    const out = body(r.content);
    expect(out.cols).toBe('m,name,price,diet,prep,c,canteen');
    expect(out.rows[0]).toEqual(['m1', 'Item 1', 10, 'V', 5, 'c1', 'Christ Bakery']);
    expect(out.rows[1][3]).toBe('N');
    expect(r.content).not.toContain('item-1');
    expect(c.refs.resolve('m1', 'm')).toBe('item-1');
  });

  it('anyDiet drops the diet filter; canteen refs are resolved', async () => {
    m.searchMenuItems.mockResolvedValue([]);
    const c = ctx();
    c.refs.ref('c', 'can-9');
    const r = await run(c, 'search_menu', { anyDiet: true, c: 'c1' });
    expect(m.searchMenuItems).toHaveBeenCalledWith(expect.objectContaining({ diet: null, canteenId: 'can-9' }));
    expect(body(r.content)).toEqual({ rows: [], found: 0 });
  });

  it('shows at most 6 rows and reports the rest in more', async () => {
    m.searchMenuItems.mockResolvedValue(Array.from({ length: 8 }, (_, i) => item(i + 1)));
    const out = body((await run(ctx(), 'search_menu', {})).content);
    expect(out.rows).toHaveLength(6);
    expect(out.more).toBe(2);
  });

  it('an unknown canteen ref is "unknown ref; search first"', async () => {
    const r = await run(ctx(), 'search_menu', { c: 'c7' });
    expect(r.ok).toBe(false);
    expect(r.content).toContain('unknown ref; search first');
  });

  it('rejects a smuggled userId argument shape only by ignoring it (not in schema)', async () => {
    m.searchMenuItems.mockResolvedValue([]);
    await run(ctx(), 'search_menu', { userId: 'someone-else', institutionId: 'other' });
    expect(m.searchMenuItems).toHaveBeenCalledWith(expect.objectContaining({ institutionId: 'inst1' }));
  });
});

describe('get_canteen_menu', () => {
  const canteen = { id: 'can-1', name: 'Christ Bakery', openingTime: '08:00', closingTime: '18:00' };

  it('lists items inside the category window, up to 24', async () => {
    m.canteenFindFirst.mockResolvedValue(canteen);
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `N${i}`, price: 5, isVeg: true, isJain: false, containsEgg: false, prepTimeMinutes: 3 }));
    m.getCanteenMenuData.mockResolvedValue({
      categories: [
        { availableFrom: '08:00', availableTo: '11:00', items: [{ ...items[0], id: 'breakfast-only' }] },
        { availableFrom: null, availableTo: null, items },
      ],
      popular: [],
    });
    const c = ctx();
    c.refs.ref('c', 'can-1');
    const out = body((await run(c, 'get_canteen_menu', { c: 'c1' })).content);
    expect(m.canteenFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'can-1', institutionId: 'inst1', isActive: true } }));
    expect(out.rows).toHaveLength(24);
    expect(out.more).toBe(6);
    expect(out.canteen).toBe('Christ Bakery');
    expect(JSON.stringify(out)).not.toContain('breakfast-only');
  });

  it('is a 404 for a canteen outside the institution', async () => {
    m.canteenFindFirst.mockResolvedValue(null);
    const c = ctx();
    c.refs.ref('c', 'other-campus');
    const r = await run(c, 'get_canteen_menu', { c: 'c1' });
    expect(r.content).toContain('Canteen not found');
  });
});

describe('find_slots', () => {
  const slot = (id: string, startTime: string, over = {}) => ({
    slotId: id, startTime, endTime: startTime.replace(/..$/, '30'), isOpen: true, isFull: false, available: 5, isCutoffPassed: false, ...over,
  });

  it('drops closed, full, past-cutoff and out-of-hours slots, returns at most 4 sorted by time', async () => {
    m.canteenFindFirst.mockResolvedValue({ openingTime: '09:00', closingTime: '17:00' });
    m.listSlots.mockResolvedValue({
      date: '2026-11-18',
      slots: [
        slot('s-closed', '13:00', { isOpen: false }),
        slot('s-full', '13:15', { isFull: true, available: 0 }),
        slot('s-cut', '13:30', { isCutoffPassed: true }),
        slot('s-early', '08:00'),
        slot('s-late', '17:30'),
        slot('a', '14:00'), slot('b', '14:15'), slot('c', '14:30'), slot('d', '14:45'), slot('e', '15:00'),
      ],
    });
    const c = ctx();
    c.refs.ref('c', 'can-1');
    const out = body((await run(c, 'find_slots', { c: 'c1' })).content);
    expect(m.listSlots).toHaveBeenCalledWith('can-1', '2026-11-18', 'STUDENT', NOW.getTime());
    expect(out.rows.map((r: unknown[]) => r[1])).toEqual(['14:00', '14:15', '14:30', '14:45']);
    expect(out.more).toBe(1);
    expect(out.cols).toBe('s,start,end,left');
  });

  it('around picks the closest slots; tomorrow uses tomorrow\'s date', async () => {
    m.canteenFindFirst.mockResolvedValue({ openingTime: '09:00', closingTime: '17:00' });
    m.listSlots.mockResolvedValue({ date: 'x', slots: ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00'].map((t, i) => slot(`s${i}`, t)) });
    const c = ctx();
    c.refs.ref('c', 'can-1');
    const out = body((await run(c, 'find_slots', { c: 'c1', day: 'tomorrow', around: '14:00' })).content);
    expect(m.listSlots).toHaveBeenCalledWith('can-1', '2026-11-19', 'STUDENT', NOW.getTime());
    expect(out.rows.map((r: unknown[]) => r[1])).toEqual(['12:00', '13:00', '14:00', '15:00']);
  });

  it('empty gives {rows:[],found:0}', async () => {
    m.canteenFindFirst.mockResolvedValue({ openingTime: '09:00', closingTime: '17:00' });
    m.listSlots.mockResolvedValue({ date: 'x', slots: [] });
    const c = ctx();
    c.refs.ref('c', 'can-1');
    expect(body((await run(c, 'find_slots', { c: 'c1' })).content)).toMatchObject({ rows: [], found: 0 });
  });
});

describe('get_my_recent_orders', () => {
  it('returns compact order rows with item refs', async () => {
    m.findRecent.mockResolvedValue([
      {
        canteenId: 'can-1', canteen: { name: 'Christ Bakery' }, createdAt: new Date('2026-11-17T08:00:00Z'), totalAmount: 55, status: 'PICKED_UP',
        items: [{ menuItemId: 'item-1', quantity: 2, menuItem: { name: 'Veg Puff', isAvailable: true } }],
      },
    ]);
    const out = body((await run(ctx(), 'get_my_recent_orders', { n: 2 })).content);
    expect(m.findRecent).toHaveBeenCalledWith('u1', 2);
    expect(out.rows[0]).toEqual(['c1', 'Christ Bakery', '2026-11-17', 55, 'PICKED_UP', [['m1', 'Veg Puff', 2, 1]]]);
  });

  it('rejects n above 3', async () => {
    expect((await run(ctx(), 'get_my_recent_orders', { n: 9 })).status).toBe('invalid');
  });

  it('empty gives found:0', async () => {
    m.findRecent.mockResolvedValue([]);
    expect(body((await run(ctx(), 'get_my_recent_orders', {})).content)).toEqual({ rows: [], found: 0 });
  });
});

describe('get_recommendations', () => {
  it('returns up to 5 rows with a reason', async () => {
    m.getRecs.mockResolvedValue([{ ...item(1), reason: 'usual' }, { ...item(2), reason: 'popular' }]);
    const out = body((await run(ctx(), 'get_recommendations', {})).content);
    expect(m.getRecs).toHaveBeenCalledWith({ userId: 'u1', institutionId: 'inst1', diet: 'veg', canteenId: undefined, at: '12:30', limit: 5 });
    expect(out.rows.map((r: unknown[]) => r[7])).toEqual(['usual', 'popular']);
  });
});

describe('get_my_points', () => {
  it('returns the balance and the three tiers', async () => {
    m.getLoyalty.mockResolvedValue({ totalPoints: 340 });
    const out = body((await run(ctx(), 'get_my_points', {})).content);
    expect(out).toMatchObject({ points: 340, tiers: [[200, 20], [500, 60], [1000, 120]] });
  });
  it('is 0 without an account', async () => {
    m.getLoyalty.mockResolvedValue(null);
    expect(body((await run(ctx(), 'get_my_points', {})).content).points).toBe(0);
  });
});

describe('propose_order', () => {
  const quote = {
    canteen: { id: 'can-1', name: 'Christ Bakery', isActive: true, razorpayAccountId: null, institutionId: 'inst1' },
    slot: { id: 'slot-1', date: new Date('2026-11-18T00:00:00Z'), startTime: '13:00', endTime: '13:15' },
    slotCap: 5,
    lines: [{ menuItemId: 'item-1', name: 'Veg Puff', isVeg: true, quantity: 2, unitPrice: 20, totalPrice: 40, counterUnitPrice: 18, customizations: {} }],
    subtotal: 40,
    totalCounterPrice: 36,
  };

  function ready() {
    const c = ctx();
    c.refs.ref('c', 'can-1');
    c.refs.ref('m', 'item-1');
    c.refs.ref('s', 'slot-1');
    m.createProposal.mockResolvedValue({ id: 'prop-1', expiresAt: new Date('2026-11-18T07:30:00Z') });
    m.quoteOrder.mockResolvedValue(quote);
    return c;
  }

  it('quotes from DB, stores a proposal, returns a card and grounding facts; it is terminal', async () => {
    const c = ready();
    const r = await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 2 }], s: 's1', followups: ['Add a drink?'] });
    expect(r).toMatchObject({ ok: true, terminal: true, followups: ['Add a drink?'] });
    expect(m.assertNotStrikeBanned).toHaveBeenCalledWith('u1');
    expect(m.quoteOrder).toHaveBeenCalledWith({
      userRole: 'STUDENT', institutionId: 'inst1', canteenId: 'can-1', slotId: 'slot-1', items: [{ menuItemId: 'item-1', quantity: 2 }],
    });
    expect(m.createProposal).toHaveBeenCalledWith(c, 'conv1', quote);
    expect(r.card).toMatchObject({
      type: 'order_proposal', proposalId: 'prop-1', subtotal: 40,
      canteen: { id: 'can-1', name: 'Christ Bakery' },
      slot: { id: 'slot-1', date: '2026-11-18', startTime: '13:00', endTime: '13:15' },
      items: [{ menuItemId: 'item-1', name: 'Veg Puff', quantity: 2, unitPrice: 20, lineTotal: 40, isVeg: true }],
    });
    expect(r.facts).toEqual(expect.arrayContaining(['Veg Puff', '2', '20', '40', '13:00', 'Christ Bakery']));
    const out = body(r.content);
    expect(out).toMatchObject({ proposal: 'p1', total: 40, slot: '13:00-13:15' });
    expect(r.content).not.toContain('prop-1');
  });

  it('merges repeated items and caps quantity at 10', async () => {
    const c = ready();
    await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 8 }, { m: 'm1', qty: 8 }] });
    expect(m.quoteOrder.mock.calls[0][0].items).toEqual([{ menuItemId: 'item-1', quantity: 10 }]);
    expect(m.quoteOrder.mock.calls[0][0].slotId).toBeNull();
  });

  it('validates arguments: qty 1-10, 1-8 items, 2 followups of 30 chars', async () => {
    const c = ready();
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 0 }] })).status).toBe('invalid');
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 11 }] })).status).toBe('invalid');
    expect((await run(c, 'propose_order', { c: 'c1', items: [] })).status).toBe('invalid');
    expect((await run(c, 'propose_order', { c: 'c1', items: Array(9).fill({ m: 'm1', qty: 1 }) })).status).toBe('invalid');
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 1 }], followups: ['a', 'b', 'c'] })).status).toBe('invalid');
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 1 }], followups: ['x'.repeat(31)] })).status).toBe('invalid');
    expect(m.createProposal).not.toHaveBeenCalled();
  });

  it('passes a strike-ban or quote error to the model and stores nothing', async () => {
    const c = ready();
    m.assertNotStrikeBanned.mockRejectedValueOnce(new AppError(403, 'temporarily blocked'));
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 1 }] })).content).toContain('temporarily blocked');
    m.quoteOrder.mockRejectedValueOnce(new AppError(400, 'Veg Puff is currently unavailable'));
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 1 }] })).content).toContain('currently unavailable');
    expect(m.createProposal).not.toHaveBeenCalled();
  });

  it('refuses refs it never issued', async () => {
    const c = ready();
    expect((await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm9', qty: 1 }] })).content).toContain('unknown ref; search first');
  });

  it('warns a veg student when an item is non-veg', async () => {
    const c = ready();
    m.quoteOrder.mockResolvedValue({ ...quote, lines: [{ ...quote.lines[0], isVeg: false }] });
    const r = await run(c, 'propose_order', { c: 'c1', items: [{ m: 'm1', qty: 1 }] });
    expect((r.card as { warnings: string[] }).warnings).toEqual(['Contains non-veg items.']);
  });
});

describe('show_items', () => {
  it('re-fetches with institution and availability filters and returns a card', async () => {
    m.menuItemFindMany.mockResolvedValue([
      { id: 'item-2', name: 'Samosa', price: 15, isVeg: true, prepTimeMinutes: 4, canteenId: 'can-1', canteen: { name: 'Christ Bakery' } },
      { id: 'item-1', name: 'Puff', price: 20, isVeg: true, prepTimeMinutes: 5, canteenId: 'can-1', canteen: { name: 'Christ Bakery' } },
    ]);
    const c = ctx();
    c.refs.ref('m', 'item-1');
    c.refs.ref('m', 'item-2');
    const r = await run(c, 'show_items', { ms: ['m1', 'm2'], title: 'Quick bites' });
    const where = m.menuItemFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isAvailable: true, canteen: { institutionId: 'inst1', isActive: true }, category: { isActive: true } });
    expect(r.terminal).toBe(true);
    expect(r.card).toMatchObject({ type: 'items', title: 'Quick bites' });
    expect((r.card as { items: { menuItemId: string }[] }).items.map((i) => i.menuItemId)).toEqual(['item-1', 'item-2']);
  });

  it('errors when nothing is available and caps at 6 refs', async () => {
    m.menuItemFindMany.mockResolvedValue([]);
    const c = ctx();
    c.refs.ref('m', 'item-1');
    expect((await run(c, 'show_items', { ms: ['m1'] })).content).toContain('none of those items are available');
    expect((await run(c, 'show_items', { ms: Array(7).fill('m1') })).status).toBe('invalid');
  });
});
