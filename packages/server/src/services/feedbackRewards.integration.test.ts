/**
 * Feedback points, mood aggregates and changelog against a real Postgres. Skipped unless TEST_DATABASE_URL
 * points at a throwaway database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('feedback rewards (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const loyalty = await import('./loyalty.service');
  const mood = await import('./feedbackMood.service');
  const changelog = await import('./feedbackChangelog.service');
  const tag = `fr${Date.now()}`;
  let instId = '';
  let adminId = '';
  let userId = '';
  let canteenId = '';
  const ordersMade: string[] = [];

  async function order() {
    const o = await prisma.order.create({
      data: {
        orderNumber: `${tag}-${randomUUID().slice(0, 8)}`, userId, canteenId, status: 'PICKED_UP', pickedUpAt: new Date(),
        subtotal: 100, totalAmount: 100,
      } as any,
    });
    ordersMade.push(o.id);
    return o;
  }
  async function review(orderId: string, over: Record<string, unknown> = {}) {
    return prisma.feedback.create({
      data: {
        kind: 'ORDER_REVIEW', userId, institutionId: instId, canteenId, orderId, overallRating: 4,
        tags: ['tasty'], clientRequestId: randomUUID(), ...over,
      } as any,
    });
  }
  const balance = async () => (await prisma.loyaltyAccount.findUnique({ where: { userId } }))?.totalPoints ?? 0;

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    instId = inst.id;
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    userId = (await prisma.user.create({
      data: { firebaseUid: `${tag}-s`, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: instId, createdAt: old },
    })).id;
    adminId = (await prisma.user.create({
      data: { firebaseUid: `${tag}-a`, email: `a@${tag}.edu`, name: 'A', role: 'ADMIN', institutionId: instId },
    })).id;
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: instId },
    })).id;
  });

  afterAll(async () => {
    const acct = await prisma.loyaltyAccount.findUnique({ where: { userId } });
    if (acct) await prisma.pointTransaction.deleteMany({ where: { loyaltyId: acct.id } });
    await prisma.loyaltyAccount.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.feedbackEvent.deleteMany({ where: { feedback: { institutionId: instId } } });
    await prisma.feedback.deleteMany({ where: { institutionId: instId } });
    await prisma.changelogEntry.deleteMany({ where: { institutionId: instId } });
    await prisma.order.deleteMany({ where: { id: { in: ordersMade } } });
    await prisma.canteen.deleteMany({ where: { id: canteenId } });
    await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: tag } } });
    await prisma.institution.deleteMany({ where: { id: instId } });
    await prisma.$disconnect();
  });

  it('a concurrent duplicate award yields exactly one transaction and one credit', async () => {
    const o = await order();
    const fb = await review(o.id);
    const before = await balance();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => loyalty.awardPointsForFeedback(prisma, { userId, feedbackId: fb.id, orderId: o.id })),
    );
    expect(results.filter((r) => r.awarded)).toHaveLength(1);
    expect(await prisma.pointTransaction.count({ where: { feedbackId: fb.id } })).toBe(1);
    expect(await balance()).toBe(before + 10);
  });

  it('stops at the daily cap of 30 across orders', async () => {
    const outcomes: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const o = await order();
      const fb = await review(o.id);
      outcomes.push((await loyalty.awardPointsForFeedback(prisma, { userId, feedbackId: fb.id, orderId: o.id })).awarded);
    }
    // One 10 point award already happened today in the previous test; the cap leaves room for two more.
    expect(outcomes.filter(Boolean).length).toBe(2);
    const s = await loyalty.getFeedbackStreak(userId);
    expect(s.pointsEarnedToday).toBe(30);
    expect(s.dailyCapRemaining).toBe(0);
    expect(s.currentStreakWeeks).toBeGreaterThanOrEqual(1);
  });

  it('helpful bonus is once only; reversal never goes below zero', async () => {
    const o = await order();
    const fb = await review(o.id, { moderation: 'CLEAN' });
    const first = await loyalty.awardHelpfulBonus(prisma, fb.id);
    const second = await loyalty.awardHelpfulBonus(prisma, fb.id);
    expect([first.awarded, second.awarded]).toEqual([true, false]);

    await prisma.loyaltyAccount.update({ where: { userId }, data: { totalPoints: 3 } }); // user spent the rest
    const rev = await loyalty.reverseFeedbackPoints(fb.id);
    expect(rev.reversed).toBe(3);
    expect(await balance()).toBe(0);
    expect((await loyalty.reverseFeedbackPoints(fb.id)).reversed).toBe(0);
  });

  it('mood aggregates: hidden below 10 ratings, flagged/hidden/deleted excluded', async () => {
    const c2 = (await prisma.canteen.create({
      data: { name: `${tag}2`, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: instId },
    })).id;
    const mk = (rating: number, over: Record<string, unknown> = {}) => prisma.feedback.create({
      data: { kind: 'CANTEEN', institutionId: instId, canteenId: c2, overallRating: rating, clientRequestId: randomUUID(), ...over } as any,
    });
    for (let i = 0; i < 9; i++) await mk(5);
    await mk(1, { moderation: 'FLAGGED' });
    await mk(1, { moderation: 'HIDDEN' });
    await mk(1, { deletedAt: new Date() });
    let m = await mood.getMoodsForCanteens([c2]);
    expect(m.get(c2)).toEqual({ mood: null, moodCount: 9 });
    await mk(4);
    m = await mood.getMoodsForCanteens([c2]);
    expect(m.get(c2)).toEqual({ mood: 4.9, moodCount: 10 });
    const sum: any = await mood.getCanteenSummary(c2, instId);
    expect(sum.mood).toBe(4.9);
    expect(sum.window).toBe('7d');
    await expect(mood.getCanteenSummary(c2, randomUUID())).rejects.toMatchObject({ status: 404 });
    await prisma.feedback.deleteMany({ where: { canteenId: c2 } });
    await prisma.canteen.delete({ where: { id: c2 } });
  });

  it('changelog flow: scoped publish, one notification per author, resolve on request', async () => {
    const o = await order();
    const f1 = await review(o.id, { status: 'SEEN', isAnonymous: true });
    const f2 = await review((await order()).id, { status: 'IN_PROGRESS' });
    const res = await changelog.publishChangelog(
      { institutionId: instId }, adminId,
      { title: 'Shorter queue', body: 'Second counter added', linkedFeedbackIds: [f1.id, f2.id], markResolved: true, canteenId },
    );
    expect(res.notified).toBe(1); // same author for both
    const after = await prisma.feedback.findMany({ where: { id: { in: [f1.id, f2.id] } } });
    expect(after.every((f) => f.status === 'RESOLVED' && f.changelogEntryId === res.entry.id)).toBe(true);
    expect(await prisma.notification.count({ where: { userId, type: 'feedback_changelog' } })).toBe(1);

    const list = await changelog.listChangelog(instId, 1, 10);
    expect(list.entries[0].id).toBe(res.entry.id);
    expect((await changelog.listChangelog(randomUUID(), 1, 10)).entries.find((e) => e.id === res.entry.id)).toBeUndefined();

    // Another institution's admin cannot link this feedback.
    await expect(
      changelog.publishChangelog({ institutionId: randomUUID() }, adminId, { title: 'x', body: 'y', linkedFeedbackIds: [f1.id] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
