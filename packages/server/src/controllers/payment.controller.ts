import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { enqueue } from '../services/outbox.service';
import { invalidateOrderViews } from '../services/catalogCache.service';
import { generatePickupCode } from '../utils/helpers';
import { OrderStatus, Prisma } from '@prisma/client';

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  transfer_id?: string;
}

interface RawRequest extends Request {
  rawBody?: Buffer;
  io?: { to: (room: string) => { emit: (event: string, data: unknown) => void } };
}

export async function razorpayWebhook(req: RawRequest, res: Response) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('[Webhook] RAZORPAY_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-razorpay-signature'] as string;
  if (!signature || !req.rawBody) {
    return res.status(400).json({ error: 'Missing signature or body' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(req.rawBody)
    .digest('hex');

  // timingSafeEqual prevents timing attacks on the HMAC comparison
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  const signatureValid = sigBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(sigBuf, expectedBuf);

  if (!signatureValid) {
    logger.warn('[Webhook] Invalid Razorpay signature');
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const { event, payload } = req.body as {
    event: string;
    payload: { payment: { entity: RazorpayPaymentEntity } };
  };

  logger.info(`[Webhook] Razorpay event: ${event}`);

  const entity = payload?.payment?.entity;
  if (!entity) return res.json({ status: 'ok' });

  if (event === 'payment.captured') {
    const razorpayOrderId = entity.order_id;
    const razorpayPaymentId = entity.id;
    const transferId = entity.transfer_id || null;

    const order = await prisma.order.findUnique({
      where: { razorpayOrderId },
      include: {
        canteen: { select: { id: true, name: true } },
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });

    // 200, not 404: Razorpay retries non-2xx responses for days.
    if (!order) {
      logger.warn(`[Webhook] Order not found for razorpayOrderId: ${razorpayOrderId} (payment ${razorpayPaymentId})`);
      return res.json({ status: 'ok' });
    }

    const expectedPaise = Math.round(Number(order.totalAmount) * 100);
    const amountOk = entity.amount === expectedPaise && entity.currency === 'INR';

    if (!amountOk) {
      logger.error(
        `[Webhook] Amount mismatch for order ${order.id}: expected ${expectedPaise} INR paise, ` +
        `captured ${entity.amount} ${entity.currency} (payment ${razorpayPaymentId}). Not confirming; crediting wallet.`
      );
      await creditCapturedPayment(order, razorpayPaymentId, entity.amount, 'Payment with unexpected amount');
      return res.json({ status: 'ok' });
    }

    const pickupCode = generatePickupCode();

    // Conditional update = idempotent: Razorpay retries webhooks.
    const count = await prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING, paymentStatus: 'AWAITING_PAYMENT' },
        data: {
          status: OrderStatus.CONFIRMED,
          paymentStatus: 'PAID',
          razorpayPaymentId,
          razorpayTransferId: transferId,
          pickupCode,
          paymentVerifiedAt: new Date(),
        },
      });
      if (result.count === 1 && order.userId) {
        await enqueue(tx, {
          type: 'notification.order',
          payload: { userId: order.userId, orderId: order.id, orderNumber: order.orderNumber, status: OrderStatus.CONFIRMED },
        });
      }
      return result.count;
    });

    if (count === 0) {
      // Not awaiting payment any more. If this very payment already confirmed it
      // (duplicate delivery) there is nothing to do; otherwise the money arrived
      // for a cancelled/expired order and goes to the wallet, exactly once.
      const current = await prisma.order.findUnique({
        where: { id: order.id },
        select: { razorpayPaymentId: true, paymentStatus: true },
      });
      const confirmedByThisPayment = current?.razorpayPaymentId === razorpayPaymentId && current.paymentStatus === 'PAID';
      if (!confirmedByThisPayment) {
        await creditCapturedPayment(order, razorpayPaymentId, entity.amount, 'Late payment');
      }
      return res.json({ status: 'ok' });
    }

    await invalidateOrderViews(order.id, order.userId);
    const updatedOrder = { ...order, status: OrderStatus.CONFIRMED, paymentStatus: 'PAID', pickupCode };

    req.io?.to(`canteen:${order.canteenId}`).emit('order:new', { order: updatedOrder });
    req.io?.to(`order:${order.id}`).emit('order:status_update', {
      orderId: order.id,
      status: OrderStatus.CONFIRMED,
      paymentStatus: 'PAID',
      pickupCode,
    });

    logger.info(`[Webhook] Order ${order.orderNumber} confirmed`);
  }

  if (event === 'payment.failed') {
    // Razorpay lets the student retry on the same order, so a failed attempt must
    // not cancel it; the auto-cancel cron expires orders that never get paid.
    logger.info(`[Webhook] Payment failed for razorpay order ${entity.order_id} (payment ${entity.id})`);
  }

  return res.json({ status: 'ok' });
}

/**
 * Credits captured money to the student's wallet exactly once per Razorpay
 * payment id. The unique wallet_transactions.razorpay_payment_id column is the
 * guard: a concurrent duplicate hits P2002 and its whole transaction (including
 * the balance increment) rolls back.
 */
async function creditCapturedPayment(
  order: { id: string; userId: string | null; orderNumber: string },
  razorpayPaymentId: string,
  amountPaise: number,
  reason: string
) {
  if (!order.userId) {
    logger.error(`[Webhook] Cannot credit payment ${razorpayPaymentId}: order ${order.id} has no user`);
    return;
  }
  const userId = order.userId;
  const amount = amountPaise / 100;
  try {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: { balance: { increment: amount } },
        create: { userId, balance: amount },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'REFUND',
          amount,
          balanceAfter: wallet.balance,
          razorpayPaymentId,
          description: `${reason} credited to wallet for Order #${order.orderNumber}`,
        },
      });
    });
    logger.info(`[Webhook] Credited ${amount} to wallet for payment ${razorpayPaymentId} (order ${order.id})`);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(`[Webhook] Payment ${razorpayPaymentId} already credited; ignoring duplicate`);
      return;
    }
    throw err;
  }
}