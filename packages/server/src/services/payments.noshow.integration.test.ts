/**
 * Webhook late-capture and no-show checks against a real Postgres. Skipped unless
 * TEST_DATABASE_URL points at a throwaway database with migrations applied.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const SECRET = 'whsec_test';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

vi.mock('./notification.service', () => ({ sendOrderNotification: vi.fn(async () => {}) }));

describe.skipIf(!url)('webhook late capture and no-show (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const { razorpayWebhook } = await import('../controllers/payment.controller');
  const { cancelOrder, sweepNoShowOrders } = await import('./order.service');
  const tag = `p${Date.now()}`;
  let seq = 0;
  let institutionId = '';
  let canteenId = '';

  async function makeUser(balance = 0) {
    const n = ++seq;
    return (await prisma.user.create({
      data: {
        firebaseUid: `${tag}-${n}`, email: `u${n}@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId,
        wallet: { create: { balance } },
      },
    })).id;
  }
  const balance = async (userId: string) =>
    Number((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance);

  async function makeOrder(userId: string, extra: Record<string, unknown> = {}) {
    const n = ++seq;
    return prisma.order.create({
      data: {
        orderNumber: `${tag}-${n}`, userId, canteenId, subtotal: 100, totalAmount: 100,
        status: 'PENDING', paymentStatus: 'AWAITING_PAYMENT', paymentMethod: 'RAZORPAY',
        razorpayOrderId: `order_${tag}_${n}`, ...extra,
      },
    });
  }

  async function webhook(event: string, entity: Record<string, unknown>) {
    const body = { event, payload: { payment: { entity } } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const sig = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    let statusCode = 200;
    const res = {
      status(c: number) { statusCode = c; return res; },
      json() { return res; },
    };
    await razorpayWebhook({ headers: { 'x-razorpay-signature': sig }, rawBody, body } as never, res as never);
    return statusCode;
  }
  const capture = (o: { razorpayOrderId: string | null }, id: string, amount = 10000, currency = 'INR') =>
    webhook('payment.captured', { id, order_id: o.razorpayOrderId, amount, currency });

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    institutionId = inst.id;
    canteenId = (await prisma.canteen.create({
      data: { name: tag, campus: 'C', openingTime: '07:00', closingTime: '20:00', institutionId },
    })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('late capture after cancel (REFUNDED status) credits wallet once, even with concurrent duplicates', async () => {
    const userId = await makeUser(0);
    const o = await makeOrder(userId, { status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    const codes = await Promise.all([capture(o, `pay_${tag}_a`), capture(o, `pay_${tag}_a`), capture(o, `pay_${tag}_a`)]);
    expect(codes).toEqual([200, 200, 200]);
    expect(await balance(userId)).toBe(100);
    await capture(o, `pay_${tag}_a`);
    expect(await balance(userId)).toBe(100);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CANCELLED');
  });

  it('late capture after a real auto-cancel (paymentStatus EXPIRED) credits wallet', async () => {
    const userId = await makeUser(0);
    const o = await makeOrder(userId);
    await cancelOrder(o.id, 'system', 'timeout');
    await capture(o, `pay_${tag}_b`);
    expect(await balance(userId)).toBe(100);
  });

  it('normal capture confirms the order and a duplicate does not credit', async () => {
    const userId = await makeUser(0);
    const o = await makeOrder(userId);
    await capture(o, `pay_${tag}_c`);
    await capture(o, `pay_${tag}_c`);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(await balance(userId)).toBe(0);
  });

  it('amount mismatch does not confirm and credits the wallet once', async () => {
    const userId = await makeUser(0);
    const o = await makeOrder(userId);
    await capture(o, `pay_${tag}_d`, 5000);
    await capture(o, `pay_${tag}_d`, 5000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PENDING');
    expect(await balance(userId)).toBe(50);
  });

  it('unknown order returns 200', async () => {
    expect(await capture({ razorpayOrderId: 'order_nope' }, `pay_${tag}_e`)).toBe(200);
    expect(await webhook('payment.failed', { id: 'pay_x', order_id: 'order_nope' })).toBe(200);
  });

  it('payment.failed leaves the order pending', async () => {
    const userId = await makeUser(0);
    const o = await makeOrder(userId);
    expect(await webhook('payment.failed', { id: `pay_${tag}_f`, order_id: o.razorpayOrderId })).toBe(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({
      status: 'PENDING', paymentStatus: 'AWAITING_PAYMENT',
    });
  });

  describe('no-show sweep', () => {
    const IST = 5.5 * 60 * 60 * 1000;
    // Slot whose end time is `minsAgo` minutes in the past (IST wall clock).
    async function slotEndedAgo(minsAgo: number) {
      const end = new Date(Date.now() - minsAgo * 60_000 + IST);
      const iso = end.toISOString();
      const endTime = iso.slice(11, 16);
      const s = ++seq;
      return prisma.pickupSlot.create({
        data: {
          canteenId, date: new Date(`${iso.slice(0, 10)}T00:00:00.000Z`),
          startTime: `S${s}`, endTime, maxOrders: 10, currentOrders: 1,
        },
      });
    }
    async function cashOrder(
      userId: string, slotId: string, walletDebit = 0, status: 'READY' | 'CONFIRMED' = 'READY'
    ) {
      const o = await makeOrder(userId, {
        paymentMethod: 'CASH', status, razorpayOrderId: null, slotId, totalAmount: 100,
      });
      if (walletDebit > 0) {
        const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
        await prisma.wallet.update({ where: { userId }, data: { balance: { decrement: walletDebit } } });
        await prisma.walletTransaction.create({
          data: { walletId: w.id, orderId: o.id, type: 'DEBIT', amount: walletDebit, balanceAfter: Number(w.balance) - walletDebit },
        });
      }
      return o;
    }

    it('expires a stale cash order once, refunds only wallet portion, strikes the user', async () => {
      const userId = await makeUser(50);
      const slot = await slotEndedAgo(90);
      const o = await cashOrder(userId, slot.id, 30);
      expect(await balance(userId)).toBe(20);

      await sweepNoShowOrders();
      await sweepNoShowOrders();

      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('NO_SHOW');
      expect(await balance(userId)).toBe(50); // 30 wallet back, 70 cash never refunded
      expect((await prisma.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } })).currentOrders).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).orderStrikes).toBe(1);
    });

    it('leaves an order inside the 60-minute window untouched', async () => {
      const userId = await makeUser(0);
      const slot = await slotEndedAgo(30);
      const o = await cashOrder(userId, slot.id);
      await sweepNoShowOrders();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('READY');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).orderStrikes).toBe(0);
    });

    it('expires an order the canteen never finished, but does not strike the student', async () => {
      const userId = await makeUser(50);
      const slot = await slotEndedAgo(90);
      const o = await cashOrder(userId, slot.id, 30, 'CONFIRMED');
      await sweepNoShowOrders();
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(after.status).toBe('NO_SHOW');
      expect(after.cancelReason).toMatch(/^Expired/);
      expect(await balance(userId)).toBe(50);
      expect((await prisma.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } })).currentOrders).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).orderStrikes).toBe(0);
    });

    it('third strike bans for 7 days and resets the counter', async () => {
      const userId = await makeUser(0);
      for (let i = 0; i < 3; i++) await cashOrder(userId, (await slotEndedAgo(120)).id);
      await sweepNoShowOrders();
      const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(u.orderStrikes).toBe(0);
      const days = (u.strikeBannedUntil!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    });
  });
});
