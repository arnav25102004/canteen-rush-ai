import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  proposalFind: vi.fn(),
  findRecent: vi.fn(),
  quoteOrder: vi.fn(),
  assertNotStrikeBanned: vi.fn(),
  createProposal: vi.fn(),
  searchMenuItems: vi.fn(),
  listSlots: vi.fn(),
}));
vi.mock('../config/database', () => ({ prisma: { assistantProposal: { findFirst: m.proposalFind } } }));
vi.mock('../services/order.service', () => ({ quoteOrder: m.quoteOrder, assertNotStrikeBanned: m.assertNotStrikeBanned, findRecentOrdersForUser: m.findRecent }));
vi.mock('../services/slot.service', () => ({ listSlotsWithAvailability: m.listSlots }));
vi.mock('../services/menu.service', async (orig) => ({ ...(await orig<typeof import('../services/menu.service')>()), searchMenuItems: m.searchMenuItems }));
vi.mock('./proposals', () => ({ createProposal: m.createProposal }));

import { AppError } from '../utils/errors';
import { buildChips, chipLang, turnActionSchema } from './chips';
import { runChipAction } from './chipActions';
import { RefMap } from './refs';
import type { TurnContext } from './context';
import type { AssistantCard } from './cards';

const ctx: TurnContext = {
  userId: 'u1', institutionId: 'i1', institutionName: 'X', role: 'STUDENT' as never, diet: 'veg', conversationId: 'conv',
  refs: new RefMap(), now: new Date('2026-11-18T07:11:00Z'),
  canteens: [{ id: 'can-1', ref: 'c1', name: 'Christ Bakery', openingTime: '07:30', closingTime: '20:00', isOpenNow: true }],
};
const conv = { id: 'conv' };
const quote = (slot: { id: string; date: Date; startTime: string; endTime: string } | null = null) => ({
  canteen: { id: 'can-1', name: 'Christ Bakery' }, slot,
  lines: [{ menuItemId: 'a', name: 'Veg Puff', isVeg: true, quantity: 2, unitPrice: 20, totalPrice: 40 }], subtotal: 40,
});

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.createProposal.mockResolvedValue({ id: 'prop', expiresAt: new Date('2026-11-18T08:00:00Z') });
  m.quoteOrder.mockImplementation(async (d: { slotId?: string | null }) => quote(d.slotId ? { id: d.slotId, date: new Date('2026-11-18T00:00:00Z'), startTime: '13:00', endTime: '13:15' } : null));
});

describe('buildChips', () => {
  const none: AssistantCard[] = [];
  const order = [{ type: 'order_proposal' }] as AssistantCard[];
  const items = [{ type: 'items' }] as AssistantCard[];

  it('has at most 3 chips with fixed labels', () => {
    expect(buildChips({ cards: none }, null, true).map((c) => c.label)).toEqual(['Same as last time?', 'Popular now']);
    expect(buildChips({ cards: order }, null, true).map((c) => c.label)).toEqual(['Earliest slot?', 'Add a drink?']);
    expect(buildChips({ cards: items }, null, true).map((c) => c.label)).toEqual(['Popular now', 'Same as last time?']);
    for (const cards of [none, order, items]) expect(buildChips({ cards }, null, true).length).toBeLessThanOrEqual(3);
  });
  it('skips the repeat chip for a student with no earlier order', () => {
    expect(buildChips({ cards: none }, null, false).map((c) => c.action.type)).toEqual(['popular_now']);
  });
  it('gives a degraded reply one navigate chip', () => {
    expect(buildChips({ cards: none, degraded: true }, null, true)).toEqual([{ label: 'Open menu', action: { type: 'navigate', target: 'menu' } }]);
  });
  it('picks Hindi labels for Devanagari text and Latin otherwise', () => {
    expect(chipLang('मुझे चाय चाहिए')).toBe('hi');
    expect(chipLang('chai chahiye')).toBe('en');
    expect(buildChips({ cards: none, lastUserText: 'चाय' }, null, false)[0].label).toBe('अभी लोकप्रिय');
  });
  it('navigate is not a valid /turn action', () => {
    expect(turnActionSchema.safeParse({ type: 'navigate' }).success).toBe(false);
    expect(turnActionSchema.safeParse({ type: 'popular_now' }).success).toBe(true);
  });
});

describe('runChipAction (code only, no model)', () => {
  it('reorder_last quotes the last order and makes a proposal card', async () => {
    m.findRecent.mockResolvedValue([{ canteenId: 'can-1', items: [
      { menuItemId: 'a', quantity: 2, menuItem: { isAvailable: true } },
      { menuItemId: 'b', quantity: 1, menuItem: { isAvailable: false } },
    ] }]);
    const r = await runChipAction(ctx, conv, { type: 'reorder_last' });
    expect(m.quoteOrder).toHaveBeenCalledWith({ userRole: 'STUDENT', institutionId: 'i1', canteenId: 'can-1', slotId: null, items: [{ menuItemId: 'a', quantity: 2 }] });
    expect(r.cards[0]).toMatchObject({ type: 'order_proposal', subtotal: 40 });
    expect(r.outcome).toBe('chip');
  });
  it('reorder_last with no earlier order says so', async () => {
    m.findRecent.mockResolvedValue([]);
    expect((await runChipAction(ctx, conv, { type: 'reorder_last' })).cards).toEqual([]);
  });
  it('turns safe AppErrors into the reply text', async () => {
    m.findRecent.mockResolvedValue([{ canteenId: 'can-1', items: [{ menuItemId: 'a', quantity: 1, menuItem: { isAvailable: true } }] }]);
    m.quoteOrder.mockRejectedValue(new AppError(400, 'Canteen is closed'));
    expect((await runChipAction(ctx, conv, { type: 'reorder_last' })).text).toBe('Canteen is closed');
  });
  it('earliest_slot re-quotes the open proposal with the earliest usable slot', async () => {
    m.proposalFind.mockResolvedValue({ canteenId: 'can-1', slotId: null, items: [{ menuItemId: 'a', quantity: 2 }] });
    m.listSlots.mockResolvedValue({ slots: [
      { slotId: 's-late', startTime: '15:00', endTime: '15:15', isOpen: true, isFull: false, available: 3, isCutoffPassed: false },
      { slotId: 's-past', startTime: '12:30', endTime: '12:45', isOpen: true, isFull: false, available: 3, isCutoffPassed: true },
      { slotId: 's-ok', startTime: '14:00', endTime: '14:15', isOpen: true, isFull: false, available: 3, isCutoffPassed: false },
    ] });
    const r = await runChipAction(ctx, conv, { type: 'earliest_slot' });
    expect(m.quoteOrder.mock.calls[0][0]).toMatchObject({ slotId: 's-ok', canteenId: 'can-1' });
    expect(r.cards[0].type).toBe('order_proposal');
    expect(r.text).toContain('14:00');
  });
  it('earliest_slot and add_drink need an open proposal', async () => {
    m.proposalFind.mockResolvedValue(null);
    expect((await runChipAction(ctx, conv, { type: 'earliest_slot' })).cards).toEqual([]);
    expect((await runChipAction(ctx, conv, { type: 'add_drink' })).cards).toEqual([]);
    expect(m.quoteOrder).not.toHaveBeenCalled();
  });
  it('add_drink adds the most popular drink not already in the order', async () => {
    m.proposalFind.mockResolvedValue({ canteenId: 'can-1', slotId: 's1', items: [{ menuItemId: 'a', quantity: 2 }] });
    m.searchMenuItems.mockResolvedValue([{ id: 'a', name: 'Veg Puff' }, { id: 'tea', name: 'Masala Tea' }]);
    const r = await runChipAction(ctx, conv, { type: 'add_drink' });
    expect(m.quoteOrder.mock.calls[0][0].items).toEqual([{ menuItemId: 'a', quantity: 2 }, { menuItemId: 'tea', quantity: 1 }]);
    expect(m.quoteOrder.mock.calls[0][0].slotId).toBe('s1');
    expect(r.text).toContain('Masala Tea');
  });
  it('popular_now returns an items card from the diet-filtered search', async () => {
    m.searchMenuItems.mockResolvedValue([{ id: 'a', name: 'Veg Puff', price: 20, isVeg: true, prepTimeMinutes: 10, canteenId: 'can-1', canteenName: 'Christ Bakery' }]);
    const r = await runChipAction(ctx, conv, { type: 'popular_now' });
    expect(m.searchMenuItems.mock.calls[0][0]).toMatchObject({ institutionId: 'i1', diet: 'veg', sort: 'popular' });
    expect(r.cards[0]).toMatchObject({ type: 'items', items: [{ name: 'Veg Puff', price: 20 }] });
  });
});
