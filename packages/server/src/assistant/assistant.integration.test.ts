/**
 * Assistant checks against a real Postgres. Skipped unless TEST_DATABASE_URL points at a
 * throwaway database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET ||= 'integration-test-only-secret-not-for-production';

describe.skipIf(!url)('assistant (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const { reserveTurn, MAX_TURNS_PER_USER, giveBackTurn } = await import('./budget');
  const { loadAssistantConfig } = await import('./config');
  const { searchMenuItems } = await import('../services/menu.service');
  const { quoteOrder } = await import('../services/order.service');
  const { createProposal, handOffProposal } = await import('./proposals');
  const { istDayString } = await import('../utils/helpers');

  const tag = `as${Date.now()}`;
  const cfg = loadAssistantConfig({ ASSISTANT_GLOBAL_DAILY_TOKENS: '1000000000' } as unknown as NodeJS.ProcessEnv);
  let userId = '';
  let otherUserId = '';
  let instId = '';
  let canteenId = '';
  let puffId = '';
  let teaId = '';
  let slotId = '';

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    const inst2 = await prisma.institution.create({ data: { name: `${tag}-b`, slug: `${tag}-b`, emailDomain: `${tag}-b.edu` } });
    instId = inst.id;
    userId = (await prisma.user.create({ data: { firebaseUid: tag, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: inst.id } })).id;
    otherUserId = (await prisma.user.create({ data: { firebaseUid: `${tag}2`, email: `t@${tag}.edu`, name: 'T', role: 'STUDENT', institutionId: inst.id } })).id;
    const canteen = await prisma.canteen.create({ data: { name: `${tag} Bakery`, campus: 'C', openingTime: '00:00', closingTime: '23:59', institutionId: inst.id } });
    canteenId = canteen.id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Snacks' } });
    puffId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: `${tag} Puff`, price: 20 } })).id;
    teaId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: `${tag} Tea`, price: 10 } })).id;
    const foreign = await prisma.canteen.create({ data: { name: `${tag} Foreign`, campus: 'C', openingTime: '00:00', closingTime: '23:59', institutionId: inst2.id } });
    const fcat = await prisma.menuCategory.create({ data: { canteenId: foreign.id, name: 'Snacks' } });
    await prisma.menuItem.create({ data: { canteenId: foreign.id, categoryId: fcat.id, name: `${tag} Puff Foreign`, price: 5 } });
    const day = new Date(`${istDayString(1)}T00:00:00.000Z`);
    slotId = (await prisma.pickupSlot.create({ data: { canteenId, date: day, startTime: '12:00', endTime: '12:15', maxOrders: 20, walkInReserved: 0, facultyReserved: 0 } })).id;
  });

  afterAll(async () => {
    await prisma.assistantDailyUsage.deleteMany({ where: { scope: { in: [userId, 'global'] } } });
    await prisma.$disconnect();
  });

  it('menu search stays inside the student\'s institution', async () => {
    const found = await searchMenuItems({ institutionId: instId, text: tag, limit: 10 });
    expect(found.map((f) => f.name).sort()).toEqual([`${tag} Puff`, `${tag} Tea`]);
  });

  it('50 parallel reserveTurn calls never pass the per-student cap', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => reserveTurn(userId, cfg)));
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_TURNS_PER_USER);
    expect(results.filter((r) => !r.ok && r.reason === 'user_limit')).toHaveLength(50 - MAX_TURNS_PER_USER);
    await giveBackTurn(userId);
    expect((await reserveTurn(userId, cfg)).ok).toBe(true);
  });

  async function propose(items = [{ menuItemId: puffId, quantity: 2 }, { menuItemId: teaId, quantity: 1 }], slot: string | null = slotId, user = userId) {
    const quote = await quoteOrder({ userRole: 'STUDENT', institutionId: instId, canteenId, slotId: slot, items });
    return createProposal({ userId: user }, null, quote);
  }

  it('hands off an unchanged proposal and a repeat is safe', async () => {
    const p = await propose();
    const a = await handOffProposal(userId, 'STUDENT', p.id, instId);
    expect(a.changes).toEqual([]);
    expect(a.slot?.id).toBe(slotId);
    expect(a.items.map((i) => i.quantity)).toEqual([2, 1]);
    const b = await handOffProposal(userId, 'STUDENT', p.id, instId);
    expect(b).toEqual(a);
    expect((await prisma.assistantProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('HANDED_OFF');
  });

  it('reports a price change', async () => {
    const p = await propose();
    await prisma.menuItem.update({ where: { id: puffId }, data: { price: 25 } });
    try {
      const r = await handOffProposal(userId, 'STUDENT', p.id, instId);
      expect(r.changes.some((c) => c.includes('price changed from ₹20 to ₹25'))).toBe(true);
    } finally {
      await prisma.menuItem.update({ where: { id: puffId }, data: { price: 20 } });
    }
  });

  it('drops an unavailable item', async () => {
    const p = await propose();
    await prisma.menuItem.update({ where: { id: teaId }, data: { isAvailable: false } });
    try {
      const r = await handOffProposal(userId, 'STUDENT', p.id, instId);
      expect(r.items.map((i) => i.menuItemId)).toEqual([puffId]);
      expect(r.changes.some((c) => c.includes('no longer available'))).toBe(true);
    } finally {
      await prisma.menuItem.update({ where: { id: teaId }, data: { isAvailable: true } });
    }
  });

  it('sets a full slot to null', async () => {
    const p = await propose();
    await prisma.pickupSlot.update({ where: { id: slotId }, data: { currentOrders: 20 } });
    try {
      const r = await handOffProposal(userId, 'STUDENT', p.id, instId);
      expect(r.slot).toBeNull();
      expect(r.changes.some((c) => c.includes('slot'))).toBe(true);
    } finally {
      await prisma.pickupSlot.update({ where: { id: slotId }, data: { currentOrders: 0 } });
    }
  });

  it('410 after expiry and 404 for another student\'s proposal', async () => {
    const p = await propose();
    await prisma.assistantProposal.update({ where: { id: p.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(handOffProposal(userId, 'STUDENT', p.id, instId)).rejects.toMatchObject({ status: 410 });
    const mine = await propose();
    await expect(handOffProposal(otherUserId, 'STUDENT', mine.id, instId)).rejects.toMatchObject({ status: 404 });
  });
});
