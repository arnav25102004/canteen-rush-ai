/**
 * Nudge claims and vendor reply against a real Postgres. Skipped unless TEST_DATABASE_URL points
 * at a throwaway database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('feedback jobs and vendor view (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const nudge = await import('./feedbackNudge.service');
  const vendor = await import('./vendorFeedback.service');
  const tag = `j${Date.now()}`;
  let userId = '';
  let vendorId = '';
  let canteenId = '';
  let itemId = '';

  async function order() {
    return prisma.order.create({
      data: {
        orderNumber: `${tag}-${randomUUID().slice(0, 8)}`, userId, canteenId, status: 'PICKED_UP',
        pickedUpAt: new Date(), subtotal: 100, totalAmount: 100, feedbackNudgeAt: new Date(Date.now() - 1000),
        items: { create: [{ menuItemId: itemId, quantity: 1, unitPrice: 100, totalPrice: 100 }] },
      } as any,
    });
  }

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    userId = (await prisma.user.create({
      data: { firebaseUid: tag, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: inst.id },
    })).id;
    vendorId = (await prisma.user.create({
      data: { firebaseUid: `${tag}v`, email: `v@${tag}.edu`, name: 'V', role: 'VENDOR', institutionId: inst.id },
    })).id;
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: inst.id },
    })).id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Food' } });
    itemId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Dosa', price: 100 } })).id;
  });

  it('nudge claim is exclusive across two concurrent runners', async () => {
    const o = await order();
    const results = await Promise.all(Array.from({ length: 6 }, () => nudge.claimFirstNudge(o.id, new Date())));
    expect(results.filter(Boolean)).toHaveLength(1);
    const again = await nudge.claimFirstNudge(o.id, new Date());
    expect(again).toBe(false);
  });

  it('a vendor can reply to a review once, and 1-star items are delayed 3 hours', async () => {
    const o = await order();
    const old = new Date(Date.now() - 4 * 3600 * 1000);
    const fresh = await prisma.feedback.create({
      data: { kind: 'ORDER_REVIEW', visibility: 'VENDOR', userId, canteenId, orderId: o.id, overallRating: 1, body: 'bad', bodyRedacted: 'bad' },
    });
    const older = await prisma.feedback.create({
      data: { kind: 'ORDER_REVIEW', visibility: 'VENDOR', userId, canteenId, overallRating: 1, body: 'meh', bodyRedacted: 'meh', createdAt: old },
    });
    const list = await vendor.listVendorFeedback(canteenId, 1, 50);
    const ids = list.feedback.map((f: any) => f.id);
    expect(ids).toContain(older.id);
    expect(ids).not.toContain(fresh.id);

    await expect(vendor.replyToFeedback({ id: vendorId, canteenId }, fresh.id, 'sorry')).rejects.toMatchObject({ status: 404 });
    const [a, b] = await Promise.allSettled([
      vendor.replyToFeedback({ id: vendorId, canteenId }, older.id, 'sorry'),
      vendor.replyToFeedback({ id: vendorId, canteenId }, older.id, 'sorry again'),
    ]);
    expect([a.status, b.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(await prisma.feedbackEvent.count({ where: { feedbackId: older.id, type: 'REPLY_PUBLIC' } })).toBe(1);
  });
});
