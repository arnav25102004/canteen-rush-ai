import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  menuFindMany: vi.fn(),
  quoteOrder: vi.fn(),
}));

vi.mock('../config/database', () => {
  const prisma: Record<string, unknown> = {
    assistantProposal: { findFirst: m.findFirst, updateMany: m.updateMany, create: m.create },
    menuItem: { findMany: m.menuFindMany },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});
vi.mock('../services/order.service', () => ({ quoteOrder: m.quoteOrder }));

import { AppError } from '../utils/errors';
import { createProposal, handOffProposal, PROPOSAL_TTL_MS, ProposalError } from './proposals';

const future = () => new Date(Date.now() + 10 * 60_000);
const stored = (over: Record<string, unknown> = {}) => ({
  id: 'p1', userId: 'u1', conversationId: 'conv', canteenId: 'can-1', slotId: 'slot-1', status: 'PROPOSED', expiresAt: future(), handedOffAt: null,
  items: [
    { menuItemId: 'a', quantity: 2, unitPrice: 20, name: 'Veg Puff' },
    { menuItemId: 'b', quantity: 1, unitPrice: 15, name: 'Samosa' },
  ],
  ...over,
});
const line = (id: string, name: string, quantity: number, unitPrice: number) => ({ menuItemId: id, name, isVeg: true, quantity, unitPrice, totalPrice: unitPrice * quantity, counterUnitPrice: unitPrice, customizations: {} });
const quote = (lines: ReturnType<typeof line>[], slot: { id: string; date: Date; startTime: string; endTime: string } | null = null) => ({
  canteen: { id: 'can-1', name: 'Christ Bakery', isActive: true, razorpayAccountId: null, institutionId: 'inst1' },
  slot, slotCap: 5, lines, subtotal: lines.reduce((s, l) => s + l.totalPrice, 0), totalCounterPrice: 0,
});
const slotInfo = { id: 'slot-1', date: new Date('2026-11-18T00:00:00Z'), startTime: '13:00', endTime: '13:15' };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.updateMany.mockResolvedValue({ count: 1 });
  m.menuFindMany.mockResolvedValue([{ id: 'a', name: 'Veg Puff', isAvailable: true }, { id: 'b', name: 'Samosa', isAvailable: true }]);
  m.quoteOrder.mockImplementation(async (d: { slotId?: string | null }) =>
    quote([line('a', 'Veg Puff', 2, 20), line('b', 'Samosa', 1, 15)], d.slotId ? slotInfo : null),
  );
});

describe('createProposal', () => {
  it('supersedes the user\'s open proposals in that conversation and stores the new one for 30 minutes', async () => {
    m.create.mockResolvedValue({ id: 'new' });
    const q = quote([line('a', 'Veg Puff', 2, 20)], slotInfo);
    const before = Date.now();
    await createProposal({ userId: 'u1' }, 'conv', q);
    expect(m.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', conversationId: 'conv', status: 'PROPOSED' }, data: { status: 'SUPERSEDED' } });
    const data = m.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: 'u1', conversationId: 'conv', canteenId: 'can-1', slotId: 'slot-1', subtotal: 40 });
    expect(data.items).toEqual([{ menuItemId: 'a', quantity: 2, unitPrice: 20, name: 'Veg Puff' }]);
    expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(PROPOSAL_TTL_MS - 1000);
    expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(PROPOSAL_TTL_MS + 1000);
  });

  it('skips the supersede step without a conversation', async () => {
    m.create.mockResolvedValue({ id: 'new' });
    await createProposal({ userId: 'u1' }, null, quote([line('a', 'Veg Puff', 1, 20)]));
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});

describe('handOffProposal', () => {
  it('hands off an unchanged proposal: no changes, status HANDED_OFF by a conditional update', async () => {
    m.findFirst.mockResolvedValue(stored());
    const r = await handOffProposal('u1', 'STUDENT' as never, 'p1', 'inst1');
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'u1' } });
    expect(r).toEqual({
      canteenId: 'can-1', canteenName: 'Christ Bakery',
      items: [{ menuItemId: 'a', name: 'Veg Puff', price: 20, isVeg: true, quantity: 2 }, { menuItemId: 'b', name: 'Samosa', price: 15, isVeg: true, quantity: 1 }],
      slot: { id: 'slot-1', date: '2026-11-18', startTime: '13:00', endTime: '13:15' },
      changes: [],
    });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', userId: 'u1', status: { in: ['PROPOSED', 'HANDED_OFF'] } },
      data: expect.objectContaining({ status: 'HANDED_OFF' }),
    });
    expect(m.quoteOrder.mock.calls[0][0]).toMatchObject({ userRole: 'STUDENT', institutionId: 'inst1', slotId: null });
  });

  it('is a 404 for another user\'s proposal (looked up by id AND userId)', async () => {
    m.findFirst.mockResolvedValue(null);
    await expect(handOffProposal('intruder', 'STUDENT' as never, 'p1')).rejects.toMatchObject({ status: 404 });
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'intruder' } });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('is a 410 PROPOSAL_EXPIRED once past expiry, and marks it EXPIRED', async () => {
    m.findFirst.mockResolvedValue(stored({ expiresAt: new Date(Date.now() - 1000) }));
    const err = await handOffProposal('u1', 'STUDENT' as never, 'p1').catch((e) => e);
    expect(err).toBeInstanceOf(ProposalError);
    expect(err).toMatchObject({ status: 410, code: 'PROPOSAL_EXPIRED' });
    expect(m.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', userId: 'u1', status: 'PROPOSED' }, data: { status: 'EXPIRED' } });
    expect(m.quoteOrder).not.toHaveBeenCalled();
  });

  it('treats a superseded proposal as expired', async () => {
    m.findFirst.mockResolvedValue(stored({ status: 'SUPERSEDED' }));
    await expect(handOffProposal('u1', 'STUDENT' as never, 'p1')).rejects.toMatchObject({ status: 410 });
  });

  it('drops an unavailable item and says so', async () => {
    m.findFirst.mockResolvedValue(stored());
    m.menuFindMany.mockResolvedValue([{ id: 'a', name: 'Veg Puff', isAvailable: true }, { id: 'b', name: 'Samosa', isAvailable: false }]);
    m.quoteOrder.mockImplementation(async (d: { slotId?: string | null }) => quote([line('a', 'Veg Puff', 2, 20)], d.slotId ? slotInfo : null));
    const r = await handOffProposal('u1', 'STUDENT' as never, 'p1');
    expect(r.items.map((i) => i.menuItemId)).toEqual(['a']);
    expect(r.changes).toEqual(['Samosa is no longer available']);
    expect(m.quoteOrder.mock.calls[0][0].items).toEqual([{ menuItemId: 'a', quantity: 2 }]);
  });

  it('is a 409 when nothing is left', async () => {
    m.findFirst.mockResolvedValue(stored());
    m.menuFindMany.mockResolvedValue([]);
    await expect(handOffProposal('u1', 'STUDENT' as never, 'p1')).rejects.toMatchObject({ status: 409 });
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it.each(['This time slot is full. Please choose another slot.', 'This time slot is closed. Please choose another slot.', 'Ordering for this slot has closed. Please choose a later slot.'])(
    'sets the slot to null and lists a change when the slot is rejected: %s',
    async (message) => {
      m.findFirst.mockResolvedValue(stored());
      m.quoteOrder.mockImplementation(async (d: { slotId?: string | null }) => {
        if (d.slotId) throw new AppError(400, message);
        return quote([line('a', 'Veg Puff', 2, 20), line('b', 'Samosa', 1, 15)]);
      });
      const r = await handOffProposal('u1', 'STUDENT' as never, 'p1');
      expect(r.slot).toBeNull();
      expect(r.items).toHaveLength(2);
      expect(r.changes).toEqual(['The pickup slot is no longer available, so no slot is selected']);
    },
  );

  it('does not swallow a server error while checking the slot', async () => {
    m.findFirst.mockResolvedValue(stored());
    m.quoteOrder.mockImplementation(async (d: { slotId?: string | null }) => {
      if (d.slotId) throw new Error('db down');
      return quote([line('a', 'Veg Puff', 2, 20)]);
    });
    await expect(handOffProposal('u1', 'STUDENT' as never, 'p1')).rejects.toThrow('db down');
  });

  it('lists price changes against the snapshot and returns the new price', async () => {
    m.findFirst.mockResolvedValue(stored());
    m.quoteOrder.mockImplementation(async (d: { slotId?: string | null }) => quote([line('a', 'Veg Puff', 2, 25), line('b', 'Samosa', 1, 15)], d.slotId ? slotInfo : null));
    const r = await handOffProposal('u1', 'STUDENT' as never, 'p1');
    expect(r.changes).toEqual(['Veg Puff price changed from ₹20 to ₹25']);
    expect(r.items[0].price).toBe(25);
  });

  it('a repeat hand-off is safe: HANDED_OFF stays allowed and handedOffAt is kept', async () => {
    const first = new Date('2026-11-18T06:00:00Z');
    m.findFirst.mockResolvedValue(stored({ status: 'HANDED_OFF', handedOffAt: first }));
    const r = await handOffProposal('u1', 'STUDENT' as never, 'p1');
    expect(r.items).toHaveLength(2);
    expect(m.updateMany.mock.calls[0][0].data.handedOffAt).toBe(first);
  });

  it('is a 410 if the proposal was superseded between the read and the update', async () => {
    m.findFirst.mockResolvedValue(stored());
    m.updateMany.mockResolvedValue({ count: 0 });
    await expect(handOffProposal('u1', 'STUDENT' as never, 'p1')).rejects.toMatchObject({ status: 410, code: 'PROPOSAL_EXPIRED' });
  });

  it('passes a canteen-level quote error (inactive or other campus) through', async () => {
    m.findFirst.mockResolvedValue(stored());
    m.quoteOrder.mockRejectedValue(new AppError(404, 'Canteen not found'));
    await expect(handOffProposal('u1', 'STUDENT' as never, 'p1', 'inst1')).rejects.toMatchObject({ status: 404 });
  });
});
