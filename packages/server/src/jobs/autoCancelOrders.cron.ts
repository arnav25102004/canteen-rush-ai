import cron, { ScheduledTask } from 'node-cron';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import { withAdvisoryLock, LOCK_KEYS } from '../utils/advisoryLock';
import { cancelOrder, sweepNoShowOrders } from '../services/order.service';

export function startAutoCancelJob(): ScheduledTask {
  let running = false;

  const task = cron.schedule('*/5 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await withAdvisoryLock(LOCK_KEYS.autoCancel, async () => {
        await cancelUnpaidOnlineOrders();
        const noShows = await sweepNoShowOrders();
        if (noShows > 0) logger.info(`[Cron] Marked ${noShows} cash orders as no-show`);
      });
    } catch (err: any) {
      logger.error('[Cron] Auto-cancel job error', { error: err.message });
    } finally {
      running = false;
    }
  });

  logger.info('[Cron] Auto-cancel job scheduled (every 5 minutes)');
  return task;
}

/**
 * Razorpay orders whose payment never completed within 10 minutes. Cash orders
 * also sit in AWAITING_PAYMENT (they're paid at pickup) and must not be touched.
 * cancelOrder releases the slot and returns wallet credit and points.
 */
async function cancelUnpaidOnlineOrders() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const unpaid = await prisma.order.findMany({
    where: {
      paymentMethod: 'RAZORPAY',
      paymentStatus: 'AWAITING_PAYMENT',
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: 500, // oldest first; the next run continues any backlog
    select: { id: true },
  });

  for (const { id } of unpaid) {
    try {
      await cancelOrder(id, 'system', 'Payment not received within 10 minutes');
    } catch (err: any) {
      logger.error(`[Cron] Failed to cancel unpaid order ${id}`, { error: err.message });
    }
  }

  if (unpaid.length > 0) {
    logger.info(`[Cron] Auto-cancelled ${unpaid.length} unpaid Razorpay orders`);
  }
}
