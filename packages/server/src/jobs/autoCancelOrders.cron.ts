import cron from 'node-cron';
import { prisma } from '../config/database';
import { OrderStatus } from '@prisma/client';

export function startAutoCancelJob() {
  let running = false;

  cron.schedule('*/5 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await cancelUnpaidOrders();
      await cancelUnverifiedOrders();
    } catch (err: any) {
      console.error('[Cron] Auto-cancel job error:', err.message);
    } finally {
      running = false;
    }
  });

  console.log('[Cron] Auto-cancel job scheduled (every 5 minutes)');
}

async function cancelUnpaidOrders() {
  // Cancel orders AWAITING_PAYMENT for more than 10 minutes
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const unpaidOrders = await prisma.order.findMany({
    where: { paymentStatus: 'AWAITING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true, userId: true, orderNumber: true, slotId: true, walletTransaction: { select: { id: true, amount: true } } },
  });

  for (const order of unpaidOrders) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'EXPIRED',
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: 'Payment not received within 10 minutes',
          },
        });

        // Refund any wallet deduction that was applied at order placement
        if (order.walletTransaction && Number(order.walletTransaction.amount) > 0) {
          const wallet = await tx.wallet.update({
            where: { userId: order.userId },
            data: { balance: { increment: Number(order.walletTransaction.amount) } },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'REFUND',
              amount: Number(order.walletTransaction.amount),
              balanceAfter: wallet.balance,
              description: `Refund for expired Order #${order.orderNumber}`,
            },
          });
        }
      });

      if (order.slotId) {
        await prisma.pickupSlot.update({ where: { id: order.slotId }, data: { currentOrders: { decrement: 1 } } });
      }
    } catch (err: any) {
      console.error(`[Cron] Failed to cancel unpaid order ${order.id}:`, err.message);
    }
  }

  if (unpaidOrders.length > 0) {
    console.log(`[Cron] Auto-cancelled ${unpaidOrders.length} unpaid orders (AWAITING_PAYMENT timeout)`);
  }
}

async function cancelUnverifiedOrders() {
  // Cancel orders PENDING_VERIFICATION for more than 15 minutes (vendor didn't confirm)
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const unverifiedOrders = await prisma.order.findMany({
    where: { paymentStatus: 'PENDING_VERIFICATION', paymentClaimedAt: { lt: cutoff } },
    select: { id: true, userId: true, orderNumber: true, slotId: true },
  });

  for (const order of unverifiedOrders) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'EXPIRED',
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: 'Payment not verified by vendor within 15 minutes',
          },
        });

        // Add a strike to the student
        await tx.user.update({ where: { id: order.userId }, data: { orderStrikes: { increment: 1 } } });
      });

      // Check if 3+ strikes → ban for 30 days
      const user = await prisma.user.findUnique({ where: { id: order.userId }, select: { orderStrikes: true } });
      if (user && user.orderStrikes >= 3) {
        await prisma.user.update({
          where: { id: order.userId },
          data: { strikeBannedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        });
        console.log(`[Cron] Student ${order.userId} banned for 30 days after 3 strikes`);
      }

      if (order.slotId) {
        await prisma.pickupSlot.update({ where: { id: order.slotId }, data: { currentOrders: { decrement: 1 } } });
      }
    } catch (err: any) {
      console.error(`[Cron] Failed to cancel unverified order ${order.id}:`, err.message);
    }
  }

  if (unverifiedOrders.length > 0) {
    console.log(`[Cron] Auto-cancelled ${unverifiedOrders.length} unverified orders (PENDING_VERIFICATION timeout)`);
  }
}
