import cron from 'node-cron';
import { prisma } from '../config/database';
import { cancelOrder } from '../services/order.service';

export function startAutoCancelJob() {
  // Run every minute — cancel unpaid orders older than 5 minutes
  cron.schedule('* * * * *', async () => {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const staleOrders = await prisma.order.findMany({
      where: {
        status: 'PENDING',
        paymentStatus: 'PENDING',
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    });

    for (const order of staleOrders) {
      await cancelOrder(order.id, 'vendor', 'Payment timeout - auto cancelled');
    }

    if (staleOrders.length > 0) {
      console.log(`[Cron] Auto-cancelled ${staleOrders.length} unpaid orders`);
    }
  });

  console.log('[Cron] Auto-cancel job scheduled (every minute)');
}
