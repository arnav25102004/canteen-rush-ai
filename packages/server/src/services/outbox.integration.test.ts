/** Retry paths of the order flow against a real Postgres. Skipped unless TEST_DATABASE_URL is set. */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.JWT_SECRET ||= 'integration-test-only-secret-not-for-production';
process.env.RAZORPAY_ENABLED = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';

const createRazorpayOrder = vi.hoisted(() => vi.fn());
vi.mock('razorpay', () => ({ default: class { orders = { create: createRazorpayOrder }; } }));

describe.skipIf(!url)('order retries (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const { placeOrder } = await import('./order.service');
  const { awardPointsForOrder } = await import('./loyalty.service');
  const { deliverOrderNotification } = await import('./notification.service');
  const { processOutboxBatch } = await import('./outbox.service');
  const tag = `o${Date.now()}`;
  let userId = '';
  let canteenId = '';
  let itemId = '';

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    userId = (await prisma.user.create({
      data: { firebaseUid: tag, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: inst.id },
    })).id;
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: inst.id, razorpayAccountId: 'acc_test' },
    })).id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Food' } });
    itemId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Dosa', price: 100 } })).id;
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it('a retry after Razorpay failed gets payment details for the same order', async () => {
    const clientRequestId = randomUUID();
    const input = { userId, userRole: 'STUDENT' as const, canteenId, items: [{ menuItemId: itemId, quantity: 1 }], clientRequestId };

    createRazorpayOrder.mockRejectedValueOnce(new Error('gateway down'));
    await expect(placeOrder(input)).rejects.toThrow('gateway down');

    createRazorpayOrder.mockResolvedValueOnce({ id: `order_${tag}` });
    const retried = await placeOrder(input);

    expect(retried.razorpay).toMatchObject({ orderId: `order_${tag}`, amount: 10000 });
    expect(await prisma.order.count({ where: { userId, idempotencyKey: clientRequestId } })).toBe(1);
  });

  it('awarding points twice for one pickup pays once', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `${tag}-award`, userId, canteenId, status: 'PICKED_UP', paymentMethod: 'CASH',
        paymentStatus: 'PAID', subtotal: 100, totalAmount: 100,
      },
    });
    await Promise.all([awardPointsForOrder(order.id), awardPointsForOrder(order.id)]);
    await awardPointsForOrder(order.id);

    const earned = await prisma.pointTransaction.findMany({ where: { orderId: order.id, type: 'EARNED' } });
    expect(earned).toHaveLength(1);
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.totalPoints).toBe(earned[0].points);
  });

  it('a repeated notification event adds one inbox row', async () => {
    const event = { userId, orderId: randomUUID(), orderNumber: `${tag}-n`, status: 'READY' as const };
    await deliverOrderNotification(event);
    await deliverOrderNotification(event);
    const rows = await prisma.notification.count({
      where: { userId, data: { equals: { orderId: event.orderId, status: 'READY' } } },
    });
    expect(rows).toBe(1);
  });

  it('an event that keeps killing its worker moves to dead letter', async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'loyalty.award', payload: { orderId: randomUUID() }, status: 'PROCESSING', attempts: 8,
        lockedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    await processOutboxBatch();
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('DEAD');
  });
});
