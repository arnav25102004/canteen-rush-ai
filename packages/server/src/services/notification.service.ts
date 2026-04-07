import { prisma } from '../config/database';
import { sendPushNotification } from '../config/firebase';
import { OrderStatus } from '@prisma/client';

const ORDER_STATUS_MESSAGES: Partial<Record<OrderStatus, { title: string; body: (num: string) => string }>> = {
  [OrderStatus.CONFIRMED]: {
    title: 'Order Confirmed!',
    body: (num) => `Order #${num} confirmed. We'll start preparing it soon.`,
  },
  [OrderStatus.ACCEPTED]: {
    title: 'Order Accepted',
    body: (num) => `Order #${num} has been accepted by the canteen.`,
  },
  [OrderStatus.PREPARING]: {
    title: 'Being Prepared',
    body: (num) => `Order #${num} is now being prepared. Almost there!`,
  },
  [OrderStatus.READY]: {
    title: 'Ready for Pickup! 🎉',
    body: (num) => `Order #${num} is ready! Show your QR code at the counter.`,
  },
  [OrderStatus.CANCELLED]: {
    title: 'Order Cancelled',
    body: (num) => `Order #${num} has been cancelled. Refund (if any) will reflect shortly.`,
  },
};

export async function sendOrderNotification(
  userId: string,
  orderId: string,
  orderNumber: string,
  status: OrderStatus
) {
  const msg = ORDER_STATUS_MESSAGES[status];
  if (!msg) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true },
  });

  await prisma.notification.create({
    data: {
      userId,
      title: msg.title,
      body: msg.body(orderNumber),
      type: 'order_update',
      data: { orderId, status },
    },
  });

  if (user?.fcmToken) {
    await sendPushNotification(user.fcmToken, msg.title, msg.body(orderNumber), {
      orderId,
      status,
    });
  }
}
