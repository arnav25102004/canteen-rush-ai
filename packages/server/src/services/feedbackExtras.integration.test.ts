/**
 * Idea votes, retention purge and aggregate reconcile against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a throwaway database with migrations applied.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('feedback extras (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const extras = await import('./feedbackExtras.service');
  const retention = await import('./feedbackRetention.service');
  const { applyItemDelta, applyCanteenDelta } = await import('./feedbackAggregates.service');
  const tag = `x${Date.now()}`;
  let instId = '';
  let authorId = '';
  let canteenId = '';
  let itemId = '';

  async function user(n: string) {
    return (await prisma.user.create({
      data: { firebaseUid: `${tag}${n}`, email: `${n}@${tag}.edu`, name: n, role: 'STUDENT', institutionId: instId },
    })).id;
  }

  async function review(rating: number, extra: Record<string, unknown> = {}) {
    const u = await user(randomUUID().slice(0, 6));
    const o = await prisma.order.create({
      data: {
        orderNumber: `${tag}-${randomUUID().slice(0, 8)}`, userId: u, canteenId, status: 'PICKED_UP', pickedUpAt: new Date(),
        subtotal: 100, totalAmount: 100,
        items: { create: [{ menuItemId: itemId, quantity: 1, unitPrice: 100, totalPrice: 100 }] },
      } as any,
    });
    const fb = await prisma.feedback.create({
      data: { kind: 'ORDER_REVIEW', userId: u, canteenId, institutionId: instId, orderId: o.id, overallRating: rating, ...extra },
    });
    await prisma.rating.create({ data: { userId: u, orderId: o.id, menuItemId: itemId, canteenId, feedbackId: fb.id, rating } });
    await prisma.$transaction(async (tx) => {
      await applyItemDelta(tx, itemId, rating, 1);
      await applyCanteenDelta(tx, canteenId, rating, 1);
    });
    return fb;
  }

  async function aggregates() {
    const i = await prisma.menuItem.findUnique({ where: { id: itemId } });
    const c = await prisma.canteen.findUnique({ where: { id: canteenId } });
    return { item: [i!.ratingSum, i!.totalRatings, Number(i!.avgRating)], canteen: [c!.ratingSum, c!.totalRatings, Number(c!.avgRating)] };
  }

  beforeAll(async () => {
    instId = (await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } })).id;
    authorId = await user('author');
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: instId },
    })).id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Food' } });
    itemId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Dosa', price: 100 } })).id;
  });

  it('concurrent duplicate votes leave exactly one vote and a count of 1', async () => {
    const idea = await prisma.feedback.create({
      data: { kind: 'APP_IDEA', userId: authorId, institutionId: instId, body: 'dark mode', bodyRedacted: 'dark mode' },
    });
    const voter = await user('voter');
    await Promise.all(Array.from({ length: 8 }, () => extras.voteIdea(voter, instId, idea.id)));
    expect(await prisma.feedbackIdeaVote.count({ where: { feedbackId: idea.id } })).toBe(1);
    expect((await prisma.feedback.findUnique({ where: { id: idea.id } }))!.voteCount).toBe(1);

    const list = await extras.listIdeas(voter, instId, 10);
    expect(list.ideas.find((i) => i.id === idea.id)).toMatchObject({ voted: true, voteCount: 1 });

    await Promise.all(Array.from({ length: 4 }, () => extras.unvoteIdea(voter, instId, idea.id)));
    expect((await prisma.feedback.findUnique({ where: { id: idea.id } }))!.voteCount).toBe(0);
    await expect(extras.voteIdea(authorId, instId, idea.id)).rejects.toMatchObject({ code: 'OWN_IDEA' });
  });

  it('retention purge keeps aggregates equal to a fresh recompute', async () => {
    await review(5);
    const gone = await review(1);
    const now = new Date();
    // soft delete the 1-star review the way the service does: aggregates move at the same time
    await prisma.$transaction(async (tx) => {
      await tx.feedback.update({ where: { id: gone.id }, data: { deletedAt: new Date(now.getTime() - 40 * 24 * 3600 * 1000) } });
      await applyItemDelta(tx, itemId, -1, -1);
      await applyCanteenDelta(tx, canteenId, -1, -1);
    });
    const before = await aggregates();
    const counts = await retention.runRetention(now, 10);
    expect(counts.purged).toBeGreaterThanOrEqual(1);
    expect(await prisma.feedback.findUnique({ where: { id: gone.id } })).toBeNull();
    const after = await aggregates();
    expect(after).toEqual(before);

    await retention.reconcileAggregates();
    expect(await aggregates()).toEqual(after); // a fresh recompute changes nothing
  });

  it('reconcile fixes injected drift', async () => {
    await prisma.menuItem.update({ where: { id: itemId }, data: { ratingSum: 999, totalRatings: 77, avgRating: 4.9 } });
    await prisma.canteen.update({ where: { id: canteenId }, data: { ratingSum: 1, totalRatings: 1, avgRating: 1 } });
    const res = await retention.reconcileAggregates();
    expect(res.itemsFixed).toBeGreaterThanOrEqual(1);
    const live = await prisma.rating.aggregate({
      where: { menuItemId: itemId, feedback: { deletedAt: null, moderation: { not: 'HIDDEN' } } }, _sum: { rating: true }, _count: { _all: true },
    });
    const a = await aggregates();
    expect(a.item.slice(0, 2)).toEqual([live._sum.rating ?? 0, live._count._all]);
    expect(a.canteen.slice(0, 2)).toEqual([live._sum.rating ?? 0, live._count._all]);
  });
});
