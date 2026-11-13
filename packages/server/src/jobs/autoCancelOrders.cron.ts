import cron from 'node-cron';
import { prisma } from '../config/database';
import { cancelOrder } from '../services/order.service';

export function startAutoCancelJob() {
  let running = false;

  cron.schedule('*/5 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await cancelUnpaidOnlineOrders();
    } catch (err: any) {
      console.error('[Cron] Auto-cancel job error:', err.message);
    } finally {
      running = false;
    }
  });

  console.log('[Cron] Auto-cancel job scheduled (every 5 minutes)');
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
    select: { id: true },
  });

  for (const { id } of unpaid) {
    try {
      await cancelOrder(id, 'system', 'Payment not received within 10 minutes');
    } catch (err: any) {
      console.error(`[Cron] Failed to cancel unpaid order ${id}:`, err.message);
    }
  }

  if (unpaid.length > 0) {
    console.log(`[Cron] Auto-cancelled ${unpaid.length} unpaid Razorpay orders`);
  }
}
