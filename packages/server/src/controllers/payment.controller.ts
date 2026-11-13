import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { sendOrderNotification } from '../services/notification.service';
import { generatePickupCode } from '../utils/helpers';
import { cancelOrder } from '../services/order.service';
import { OrderStatus } from '@prisma/client';

interface RawRequest extends Request {
  rawBody?: Buffer;
  io?: { to: (room: string) => { emit: (event: string, data: unknown) => void } };
}

export async function razorpayWebhook(req: RawRequest, res: Response) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Webhook] RAZORPAY_WEBHOOK_SECRET not set');
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
    console.warn('[Webhook] Invalid Razorpay signature');
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const { event, payload } = req.body as {
    event: string;
    payload: { payment: { entity: Record<string, string> } };
  };

  console.log(`[Webhook] Razorpay event: ${event}`);

  if (event === 'payment.captured') {
    const razorpayOrderId = payload.payment.entity.order_id;
    const razorpayPaymentId = payload.payment.entity.id;
    const transferId = payload.payment.entity.transfer_id || null;

    const order = await prisma.order.findUnique({
      where: { razorpayOrderId },
      include: {
        canteen: { select: { id: true, name: true } },
        items: { include: { menuItem: { select: { name: true } } } },
      },
    });

    if (!order) {
      console.warn(`[Webhook] Order not found for razorpayOrderId: ${razorpayOrderId}`);
      return res.status(404).json({ error: 'Order not found' });
    }

    // Money arrived for an order that was already cancelled (e.g. the student
    // paid after the 10-minute timeout). Credit the wallet once, never resurrect it.
    if (order.status === OrderStatus.CANCELLED) {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.order.updateMany({
          where: { id: order.id, paymentStatus: { notIn: ['PAID', 'REFUNDED'] } },
          data: { paymentStatus: 'REFUNDED', razorpayPaymentId },
        });
        if (count === 0 || !order.userId) return;
        const wallet = await tx.wallet.upsert({
          where: { userId: order.userId },
          update: { balance: { increment: order.totalAmount } },
          create: { userId: order.userId, balance: order.totalAmount },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'REFUND',
            amount: order.totalAmount,
            balanceAfter: wallet.balance,
            description: `Late payment refunded for cancelled Order #${order.orderNumber}`,
          },
        });
      });
      return res.json({ status: 'ok' });
    }

    const pickupCode = generatePickupCode();

    // Conditional update = idempotent: Razorpay retries webhooks.
    const { count } = await prisma.order.updateMany({
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
    if (count === 0) return res.json({ status: 'ok' });

    const updatedOrder = { ...order, status: OrderStatus.CONFIRMED, paymentStatus: 'PAID', pickupCode };

    req.io?.to(`canteen:${order.canteenId}`).emit('order:new', { order: updatedOrder });
    req.io?.to(`order:${order.id}`).emit('order:status_update', {
      orderId: order.id,
      status: OrderStatus.CONFIRMED,
      paymentStatus: 'PAID',
      pickupCode,
    });

    if (order.userId) await sendOrderNotification(order.userId, order.id, order.orderNumber, OrderStatus.CONFIRMED);
    console.log(`[Webhook] Order ${order.orderNumber} confirmed`);
  }

  if (event === 'payment.failed') {
    const razorpayOrderId = payload.payment.entity.order_id;
    const order = await prisma.order.findUnique({
      where: { razorpayOrderId },
      select: { id: true, orderNumber: true, status: true },
    });

    if (order && order.status === OrderStatus.PENDING) {
      // cancelOrder also returns any wallet credit / points used on this order.
      await cancelOrder(order.id, 'system', 'Razorpay payment failed', req.io, { paymentStatus: 'FAILED' })
        .catch((err) => console.warn(`[Webhook] Cancel after failed payment skipped: ${err.message}`));
      console.log(`[Webhook] Payment failed for order ${order.orderNumber}`);
    }
  }

  return res.json({ status: 'ok' });
}
