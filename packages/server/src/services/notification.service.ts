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
  [OrderStatus.NO_SHOW]: {
    title: 'Order Not Collected',
    body: (num) => `Order #${num} was not collected and has expired. Any wallet credit used was returned, and a no-show strike was added.`,
  },
  [OrderStatus.CANCELLED]: {
    title: 'Order Cancelled',
    body: (num) => `Order #${num} has been cancelled. Refund (if any) will reflect shortly.`,
  },
};

export interface OrderNotificationEvent {
  userId: string;
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
}

/** Run by the outbox worker. Throws on a DB failure so the event is retried. */
export async function deliverOrderNotification({ userId, orderId, orderNumber, status }: OrderNotificationEvent) {
  const msg = ORDER_STATUS_MESSAGES[status];
  if (!msg) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true, isDeleted: true },
  });
  if (!user || user.isDeleted) return;

  // Delivery is at-least-once: a retried event must not add a second inbox row or push.
  const data = { orderId, status };
  const delivered = await prisma.notification.findFirst({
    where: { userId, type: 'order_update', data: { equals: data } },
    select: { id: true },
  });
  if (delivered) return;

  await prisma.notification.create({
    data: { userId, title: msg.title, body: msg.body(orderNumber), type: 'order_update', data },
  });

  if (user.fcmToken) {
    await sendPushNotification(user.fcmToken, msg.title, msg.body(orderNumber), {
      orderId,
      status,
    });
  }
}

export interface UserNotification {
  title: string;
  body: string;
  type: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Tell one user something. The in-app Notification row is always written (and its failure is
 * thrown, since that is the record of truth). The push is best effort: a missing token, FCM
 * being off or an FCM error never breaks the caller.
 */
export async function notifyUser(userId: string, n: UserNotification) {
  await prisma.notification.create({
    data: { userId, title: n.title, body: n.body, type: n.type, data: n.data ?? {} },
  });
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } });
    if (user?.fcmToken) {
      const strData: Record<string, string> = {};
      for (const [k, v] of Object.entries(n.data ?? {})) strData[k] = String(v);
      await sendPushNotification(user.fcmToken, n.title, n.body, { type: n.type, ...strData });
    }
  } catch {
    // push is optional
  }
}
