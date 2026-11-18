/**
 * Moderation, bulk and export against a real Postgres. Skipped unless TEST_DATABASE_URL points at
 * a throwaway database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('feedback moderation (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const fb = await import('./feedback.service');
  const mod = await import('./feedbackModerationAdmin.service');
  const exp = await import('./feedbackExport.service');
  const tag = `fm${Date.now()}`;
  let instId = '';
  let adminId = '';
  let canteenId = '';
  let itemId = '';
  const reviewIds: string[] = [];
  const userIds: string[] = [];
  const scope = () => ({ institutionId: instId });

  async function recompute() {
    const hidden = await prisma.feedback.findMany({ where: { canteenId, moderation: 'HIDDEN' }, select: { id: true } });
    const ratings = await prisma.rating.findMany({ where: { menuItemId: itemId, feedbackId: { notIn: hidden.map((h) => h.id) } } });
    const fbs = await prisma.feedback.findMany({
      where: { canteenId, kind: 'ORDER_REVIEW', deletedAt: null, moderation: { not: 'HIDDEN' } }, select: { overallRating: true },
    });
    return {
      item: { sum: ratings.reduce((a, r) => a + r.rating, 0), n: ratings.length },
      canteen: { sum: fbs.reduce((a, f) => a + (f.overallRating ?? 0), 0), n: fbs.length },
    };
  }
  async function stored() {
    const m = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
    const c = await prisma.canteen.findUniqueOrThrow({ where: { id: canteenId } });
    return { item: { sum: m.ratingSum, n: m.totalRatings }, canteen: { sum: c.ratingSum, n: c.totalRatings } };
  }

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.test` } as any });
    instId = inst.id;
    const admin = await prisma.user.create({
      data: { firebaseUid: `${tag}-a`, email: `${tag}-a@t.in`, name: 'adm', role: 'ADMIN', institutionId: instId } as any,
    });
    adminId = admin.id;
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: instId },
    })).id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Food' } });
    itemId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Dosa', price: 100 } })).id;

    for (const [i, rating] of [5, 4, 2, 1].entries()) {
      const u = await prisma.user.create({
        data: { firebaseUid: `${tag}-s${i}`, email: `${tag}-s${i}@t.in`, name: `s${i}`, role: 'STUDENT', institutionId: instId } as any,
      });
      userIds.push(u.id);
      const o = await prisma.order.create({
        data: {
          orderNumber: `${tag}-${i}`, userId: u.id, canteenId, status: 'PICKED_UP', pickedUpAt: new Date(), subtotal: 100, totalAmount: 100,
          items: { create: [{ menuItemId: itemId, quantity: 1, unitPrice: 100, totalPrice: 100 }] },
        } as any,
      });
      const { feedback } = await fb.createOrderReview(u.id, {
        orderId: o.id, clientRequestId: randomUUID(), overallRating: rating, items: [{ menuItemId: itemId, rating }],
      } as any);
      reviewIds.push(feedback.id);
    }
  });

  afterAll(async () => {
    const all = await prisma.feedback.findMany({ where: { institutionId: instId }, select: { id: true } });
    const ids = all.map((f) => f.id);
    await prisma.feedbackReport.deleteMany({ where: { feedbackId: { in: ids } } });
    await prisma.feedbackEvent.deleteMany({ where: { feedbackId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rating.deleteMany({ where: { canteenId } });
    await prisma.feedback.deleteMany({ where: { id: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { order: { canteenId } } });
    await prisma.order.deleteMany({ where: { canteenId } });
    await prisma.menuItem.deleteMany({ where: { canteenId } });
    await prisma.menuCategory.deleteMany({ where: { canteenId } });
    await prisma.canteen.deleteMany({ where: { id: canteenId } });
    await prisma.feedbackExportAudit.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: tag } } });
    await prisma.institution.deleteMany({ where: { id: instId } });
    await prisma.$disconnect();
  });

  it('starts with aggregates equal to a fresh recompute', async () => {
    expect(await stored()).toEqual(await recompute());
    expect((await stored()).canteen).toEqual({ sum: 12, n: 4 });
  });

  it('hide then unhide keeps aggregates equal to a fresh recompute, and double hide changes nothing', async () => {
    await mod.moderateFeedback(scope(), reviewIds[0], adminId, 'HIDE', 'spam');
    await mod.moderateFeedback(scope(), reviewIds[0], adminId, 'HIDE', 'spam');
    expect(await stored()).toEqual(await recompute());
    expect((await stored()).canteen).toEqual({ sum: 7, n: 3 });
    const c = await prisma.canteen.findUniqueOrThrow({ where: { id: canteenId } });
    expect(c.avgRating).toBeCloseTo(2.3, 5);

    await mod.moderateFeedback(scope(), reviewIds[0], adminId, 'CLEAR', 'fine');
    await mod.moderateFeedback(scope(), reviewIds[0], adminId, 'CLEAR', 'fine');
    expect(await stored()).toEqual(await recompute());
    expect((await stored()).canteen).toEqual({ sum: 12, n: 4 });
  });

  it('deleting a hidden review does not subtract it a second time', async () => {
    await mod.moderateFeedback(scope(), reviewIds[3], adminId, 'HIDE', 'spam');
    const owner = await prisma.feedback.findUniqueOrThrow({ where: { id: reviewIds[3] } });
    await fb.deleteOrderReview(owner.userId as string, reviewIds[3]);
    expect((await stored()).canteen).toEqual({ sum: 11, n: 3 });
    expect(await stored()).toEqual(await recompute());
  });

  it('bulk race: two concurrent bulk hides apply each row once', async () => {
    const ids = [reviewIds[1], reviewIds[2]];
    const results = await Promise.allSettled([
      mod.bulkUpdate(scope(), adminId, { ids, action: 'HIDE', reason: 'spam wave' }),
      mod.bulkUpdate(scope(), adminId, { ids, action: 'HIDE', reason: 'spam wave' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await stored()).toEqual(await recompute());
    expect((await stored()).canteen).toEqual({ sum: 5, n: 1 });
    const events = await prisma.feedbackEvent.count({ where: { feedbackId: { in: ids }, type: 'moderated' } });
    expect(events).toBe(2);
  });

  it('bulk reports other institutions as not found', async () => {
    const out = await mod.bulkUpdate({ institutionId: randomUUID() }, adminId, { ids: [reviewIds[0]], action: 'SET_PRIORITY', value: 'HIGH' });
    expect(out.results).toEqual([{ id: reviewIds[0], ok: false, error: 'Not found' }]);
  });

  it('export honours the row cap and never leaks anonymous identity', async () => {
    for (let i = 0; i < 12; i++) {
      await prisma.feedback.create({
        data: {
          kind: 'APP_BUG', institutionId: instId, userId: userIds[0], isAnonymous: i % 2 === 0, body: i === 11 ? '=cmd|calc' : 'bug',
          clientRequestId: randomUUID(),
        } as any,
      });
    }
    let out = '';
    for await (const c of exp.exportChunks(scope(), { kind: 'APP_BUG' as any }, true, undefined, 7)) out += c;
    const lines = out.trimEnd().split('\r\n');
    expect(lines).toHaveLength(8); // header + 7
    expect(out).toContain(`'=cmd|calc`);
    for (const l of lines.slice(1)) if (l.includes('"yes"')) expect(l).not.toContain(`${tag}-s0@t.in`);
  });

  it('dashboard SQL runs, is scoped and excludes hidden feedback', async () => {
    const dash = await import('./feedbackDashboard.service');
    const d = await dash.feedbackDashboard(scope(), 30);
    // reviewIds[0] is visible (5), others hidden or deleted by the earlier tests: 1 rated row remains
    expect(d.distribution.reduce((a, x) => a + x.count, 0)).toBe(1);
    expect(d.distribution[4].count).toBe(1);
    expect(d.ratingTrend.daily).toHaveLength(1);
    expect(d.bugsByVersion[0]).toEqual({ version: 'unknown', count: 12 });
    expect(d.leaderboard[0]).toMatchObject({ canteenId, sampleSize: 1, enoughData: false, avg: null });
    const other = await dash.feedbackDashboard({ institutionId: randomUUID() }, 30);
    expect(other.leaderboard).toEqual([]);
  });
});
