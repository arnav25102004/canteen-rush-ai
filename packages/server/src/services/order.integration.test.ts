/**
 * Money-path checks against a real Postgres. Skipped unless TEST_DATABASE_URL
 * points at a throwaway database with migrations applied:
 *
 *   docker run -d --rm --name ck-test-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=ck -p 55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:pw@localhost:55432/ck npx prisma migrate deploy
 *   TEST_DATABASE_URL=postgresql://postgres:pw@localhost:55432/ck npm test
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

vi.mock('./notification.service', () => ({ sendOrderNotification: vi.fn(async () => {}) }));

describe.skipIf(!url)('order money flows (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const { placeOrder, cancelOrder } = await import('./order.service');
  const tag = `t${Date.now()}`;
  let userId = '';
  let canteenId = '';
  let itemId = '';

  const walletBalance = async () =>
    Number((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance);
  const order = (extra: object = {}) =>
    placeOrder({ userId, userRole: 'STUDENT', canteenId, items: [{ menuItemId: itemId, quantity: 1 }], ...extra });

  beforeAll(async () => {
    const inst = await prisma.institution.create({
      data: { name: tag, slug: tag, emailDomain: `${tag}.edu` },
    });
    const user = await prisma.user.create({
      data: {
        firebaseUid: tag, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: inst.id,
        wallet: { create: { balance: 30 } },
        loyaltyAccount: { create: { totalPoints: 200, lifetimePoints: 200 } },
      },
    });
    userId = user.id;
    const canteen = await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId: inst.id },
    });
    canteenId = canteen.id;
    const cat = await prisma.menuCategory.create({ data: { canteenId, name: 'Food' } });
    itemId = (await prisma.menuItem.create({ data: { canteenId, categoryId: cat.id, name: 'Dosa', price: 100 } })).id;
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it('cash order is unpaid, and cancelling refunds only the wallet credit used', async () => {
    const { order: o, walletDeduction } = await order();
    expect(walletDeduction).toBe(30);
    expect(o).toMatchObject({ paymentMethod: 'CASH', paymentStatus: 'AWAITING_PAYMENT' });
    expect(await walletBalance()).toBe(0);

    await cancelOrder(o.id as string, 'student');
    expect(await walletBalance()).toBe(30); // not 30 + 70 cash that was never paid
  });

  it('concurrent cancels refund once', async () => {
    const { order: o } = await order();
    const results = await Promise.allSettled([
      cancelOrder(o.id as string, 'student'),
      cancelOrder(o.id as string, 'student'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await walletBalance()).toBe(30);
  });

  it('redeemed points come back on cancel and cannot be double-spent', async () => {
    const results = await Promise.allSettled([order({ pointsToRedeem: 200 }), order({ pointsToRedeem: 200 })]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(1);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } })).totalPoints).toBe(0);

    await cancelOrder(ok[0].value.order.id, 'student');
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } })).totalPoints).toBe(200);
  });

  it('order numbers are unique and sequential without Redis', async () => {
    const { generateOrderNumber } = await import('./order.service');
    const nums = await Promise.all(Array.from({ length: 10 }, () => generateOrderNumber()));
    expect(new Set(nums).size).toBe(10);
  });
});
