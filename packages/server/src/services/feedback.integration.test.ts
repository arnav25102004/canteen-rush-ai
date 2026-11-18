/**
 * Order-review flows against a real Postgres. Skipped unless TEST_DATABASE_URL points at a
 * throwaway database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('order reviews (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const svc = await import('./feedback.service');
  const tag = `f${Date.now()}`;
  let userId = '';
  let canteenId = '';
  let item1 = '';
  let item2 = '';

  async function pickedUpOrder(status: 'PICKED_UP' | 'READY' = 'PICKED_UP', items = [item1, item2]) {
    return prisma.order.create({
      data: {
        orderNumber: `${tag}-${randomUUID().slice(0, 8)}`,
        userId, canteenId, status, pickedUpAt: status === 'PICKED_UP' ? new Date() : null,
        subtotal: 100, totalAmount: 100,
        items: { create: items.map((id) => ({ menuItemId: id, quantity: 1, unitPrice: 100, totalPrice: 100 })) },
      } as any,
    });
  }
  const review = (orderId: string, extra: object = {}) => ({
    orderId, clientRequestId: randomUUID(), overallRating: 4,
    items: [{ menuItemId: item1, rating: 5 }, { menuItemId: item2, rating: 3 }], ...extra,
  });

  /** Aggregates recomputed from scratch from live feedback and rating rows. */
  async function recompute() {
    const fb = await prisma.feedback.aggregate({
      where: { canteenId, kind: 'ORDER_REVIEW', deletedAt: null },
      _sum: { overallRating: true }, _count: true,
    });
    const items: Record<string, { sum: number; count: number }> = {};
    for (const id of [item1, item2]) {
      const a = await prisma.rating.aggregate({
        where: { menuItemId: id, feedback: { deletedAt: null } }, _sum: { rating: true }, _count: true,
      });
      items[id] = { sum: a._sum.rating ?? 0, count: a._count };
    }
    return { canteen: { sum: fb._sum.overallRating ?? 0, count: fb._count }, items };
  }
  async function stored() {
    const c = await prisma.canteen.findUniqueOrThrow({ where: { id: canteenId } });
    const out: any = { canteen: { sum: c.ratingSum, count: c.totalRatings }, items: {} };
    for (const id of [item1, item2]) {
      const m = await prisma.menuItem.findUniqueOrThrow({ where: { id } });
      out.items[id] = { sum: m.ratingSum, count: m.totalRatings };
    }
    return out;
  }

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    userId = (await prisma.user.create({
      data: { firebaseUid: tag, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: inst.id },
    })).id;
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: inst.id },
    })).id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Food' } });
    item1 = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Dosa', price: 100 } })).id;
    item2 = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Tea', price: 100 } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('rejects an order that is not PICKED_UP', async () => {
    const o = await pickedUpOrder('READY');
    await expect(svc.createOrderReview(userId, review(o.id) as any)).rejects.toMatchObject({ status: 409 });
  });

  it('concurrent duplicate requests with one clientRequestId create a single review', async () => {
    const o = await pickedUpOrder();
    const input = review(o.id);
    const results = await Promise.all([1, 2, 3].map(() => svc.createOrderReview(userId, input as any)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.feedback.id)).size).toBe(1);
    expect(await prisma.feedback.count({ where: { orderId: o.id } })).toBe(1);
    expect(await stored()).toEqual(await recompute());
  });

  it('a second review of the same order is 409 ALREADY_REVIEWED with the first id', async () => {
    const o = await pickedUpOrder();
    const first = await svc.createOrderReview(userId, review(o.id) as any);
    await expect(svc.createOrderReview(userId, review(o.id) as any)).rejects.toMatchObject({
      status: 409, code: 'ALREADY_REVIEWED', extra: { feedbackId: first.feedback.id },
    });
  });

  it('aggregates equal a fresh recompute after edits and delete, and the order can be re-reviewed', async () => {
    const o = await pickedUpOrder();
    const { feedback } = await svc.createOrderReview(userId, review(o.id) as any);
    await svc.updateOrderReview(userId, feedback.id, { overallRating: 1, items: [{ menuItemId: item1, rating: 2 }] });
    await svc.updateOrderReview(userId, feedback.id, { overallRating: 5, items: [{ menuItemId: item2, rating: 5 }] });
    expect(await stored()).toEqual(await recompute());

    await svc.deleteOrderReview(userId, feedback.id);
    expect(await stored()).toEqual(await recompute());
    await expect(svc.getMine(userId, feedback.id)).rejects.toMatchObject({ status: 404 });

    await svc.createOrderReview(userId, review(o.id) as any);
    expect(await stored()).toEqual(await recompute());
  });

  it('stops edits after three', async () => {
    const o = await pickedUpOrder();
    const { feedback } = await svc.createOrderReview(userId, review(o.id) as any);
    for (let i = 0; i < 3; i++) await svc.updateOrderReview(userId, feedback.id, { overallRating: (i % 5) + 1 });
    await expect(svc.updateOrderReview(userId, feedback.id, { overallRating: 2 })).rejects.toMatchObject({ code: 'EDIT_LIMIT' });
    expect(await stored()).toEqual(await recompute());
  });

  it('account deletion keeps aggregates and severs the link to the user', async () => {
    const inst = await prisma.institution.findFirstOrThrow({ where: { slug: tag } });
    const u2 = await prisma.user.create({
      data: { firebaseUid: `${tag}b`, email: `b@${tag}.edu`, name: 'B', role: 'STUDENT', institutionId: inst.id },
    });
    const o = await prisma.order.create({
      data: {
        orderNumber: `${tag}-${randomUUID().slice(0, 8)}`, userId: u2.id, canteenId, status: 'PICKED_UP',
        pickedUpAt: new Date(), subtotal: 100, totalAmount: 100,
        items: { create: [{ menuItemId: item1, quantity: 1, unitPrice: 100, totalPrice: 100 }] },
      } as any,
    });
    const { feedback } = await svc.createOrderReview(u2.id, {
      orderId: o.id, clientRequestId: randomUUID(), overallRating: 3, body: 'secret text',
      items: [{ menuItemId: item1, rating: 4 }],
    } as any);
    const before = await stored();

    await prisma.$transaction((tx) => svc.anonymiseUserFeedback(tx, u2.id));

    expect(await stored()).toEqual(before);
    expect(await stored()).toEqual(await recompute());
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: feedback.id }, include: { ratings: true } });
    expect(row).toMatchObject({ userId: null, body: null, isAnonymous: true, overallRating: 3 });
    expect(row.ratings.every((r) => r.userId === null)).toBe(true);
  });
});
