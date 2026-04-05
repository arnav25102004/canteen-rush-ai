import { prisma } from '../config/database';
import { incrOrderSeq } from '../config/redis';
import { generateQRToken } from './qr.service';
import { incrementSlotOrders, decrementSlotOrders } from './slot.service';
import { sendOrderNotification } from './notification.service';
import { PaymentMethod, OrderStatus } from '@prisma/client';

interface PlaceOrderInput {
  userId: string;
  canteenId: string;
  slotId?: string;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, unknown>; notes?: string }>;
  paymentMethod: PaymentMethod;
  specialInstructions?: string;
}

export async function generateOrderNumber(canteenId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = await incrOrderSeq(today);
  return `CC-${today}-${String(seq).padStart(4, '0')}`;
}

export async function placeOrder(input: PlaceOrderInput, io?: unknown) {
  const { userId, canteenId, slotId, items, paymentMethod, specialInstructions } = input;

  // Fetch only items belonging to this canteen — eliminates cross-canteen loop validation
  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: items.map((i) => i.menuItemId) },
      canteenId,
    },
    select: { id: true, name: true, price: true, isAvailable: true, canteenId: true },
  });

  if (menuItems.length !== items.length) {
    throw new Error('One or more items are invalid or belong to a different canteen');
  }

  const unavailable = menuItems.filter((m) => !m.isAvailable);
  if (unavailable.length > 0) {
    throw new Error(`${unavailable.map((m) => m.name).join(', ')} ${unavailable.length > 1 ? 'are' : 'is'} currently unavailable`);
  }

  if (slotId) {
    const booked = await incrementSlotOrders(slotId);
    if (!booked) throw new Error('This time slot is full or closed. Please choose another slot.');
  }

  let subtotal = 0;
  const orderItems = items.map((item) => {
    const mi = menuItems.find((m) => m.id === item.menuItemId)!;
    const totalPrice = Number(mi.price) * item.quantity;
    subtotal += totalPrice;
    return {
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPrice: Number(mi.price),
      totalPrice,
      customizations: item.customizations ?? {},
      notes: item.notes,
    };
  });

  const totalAmount = subtotal; // platformFee = 0
  const orderNumber = await generateOrderNumber(canteenId);

  let initialStatus: OrderStatus = OrderStatus.PENDING;
  let paymentStatus: 'PENDING' | 'PAID' = 'PENDING';

  if (paymentMethod === PaymentMethod.WALLET) {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    if (!wallet || Number(wallet.balance) < totalAmount) {
      if (slotId) await decrementSlotOrders(slotId);
      throw new Error('Insufficient wallet balance. Please recharge.');
    }
    initialStatus = OrderStatus.CONFIRMED;
    paymentStatus = 'PAID';
  }

  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        userId,
        canteenId,
        slotId,
        status: initialStatus,
        paymentStatus,
        paymentMethod,
        subtotal,
        platformFee: 0,
        totalAmount,
        specialInstructions,
        items: { create: orderItems },
      },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        slot: { select: { startTime: true, endTime: true } },
      },
    });

    if (paymentStatus === 'PAID') {
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: totalAmount } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: updatedWallet.id,
          orderId: newOrder.id,
          type: 'DEBIT',
          amount: totalAmount,
          balanceAfter: updatedWallet.balance,
          description: `Order #${orderNumber}`,
        },
      });

      const qrToken = generateQRToken({ orderId: newOrder.id, userId, orderNumber, canteenId });
      await tx.order.update({ where: { id: newOrder.id }, data: { qrCode: qrToken } });
      return { ...newOrder, qrCode: qrToken };
    }

    return newOrder;
  });

  // Batch update totalOrders counts
  await prisma.$transaction(
    items.map((item) =>
      prisma.menuItem.update({
        where: { id: item.menuItemId },
        data: { totalOrders: { increment: item.quantity } },
      })
    )
  );

  const ioServer = io as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  ioServer?.to(`canteen:${canteenId}`).emit('order:new', { order });

  await sendOrderNotification(userId, order.id, orderNumber, OrderStatus.CONFIRMED);

  return order;
}

export async function cancelOrder(
  orderId: string,
  cancelledBy: 'student' | 'vendor',
  reason?: string,
  io?: unknown
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, userId: true, canteenId: true, slotId: true, totalAmount: true, paymentStatus: true, paymentMethod: true, orderNumber: true },
  });

  if (!order) throw new Error('Order not found');

  if (cancelledBy === 'student' && ![OrderStatus.PENDING, OrderStatus.CONFIRMED].includes(order.status)) {
    throw new Error('Cannot cancel order that is already being prepared');
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
    });

    if (order.paymentStatus === 'PAID' && order.paymentMethod === PaymentMethod.WALLET) {
      const wallet = await tx.wallet.update({
        where: { userId: order.userId },
        data: { balance: { increment: Number(order.totalAmount) } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          orderId,
          type: 'REFUND',
          amount: Number(order.totalAmount),
          balanceAfter: wallet.balance,
          description: `Refund for cancelled order #${order.orderNumber}`,
        },
      });
    }
  });

  if (order.slotId) await decrementSlotOrders(order.slotId);

  const ioServer = io as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  ioServer?.to(`order:${orderId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });
  ioServer?.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });

  await sendOrderNotification(order.userId, orderId, order.orderNumber, OrderStatus.CANCELLED);
}
