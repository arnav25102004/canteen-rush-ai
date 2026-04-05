import { prisma } from '../config/database';
import { redis, incrOrderSeq } from '../config/redis';
import { generateQRToken, generateQRCodeDataURL } from './qr.service';
import { incrementSlotOrders, decrementSlotOrders } from './slot.service';
import { sendOrderNotification } from './notification.service';
import { PaymentMethod, OrderStatus } from '@prisma/client';

interface PlaceOrderInput {
  userId: string;
  canteenId: string;
  slotId?: string;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, any>; notes?: string }>;
  paymentMethod: PaymentMethod;
  specialInstructions?: string;
}

export async function generateOrderNumber(canteenId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = await incrOrderSeq(today);
  return `CC-${today}-${String(seq).padStart(4, '0')}`;
}

export async function placeOrder(input: PlaceOrderInput, io?: any) {
  const { userId, canteenId, slotId, items, paymentMethod, specialInstructions } = input;

  // Validate all menu items belong to the same canteen and are available
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) } },
  });

  for (const mi of menuItems) {
    if (mi.canteenId !== canteenId) throw new Error(`Item ${mi.name} doesn't belong to this canteen`);
    if (!mi.isAvailable) throw new Error(`${mi.name} is currently unavailable`);
  }

  // Validate slot
  if (slotId) {
    const booked = await incrementSlotOrders(slotId);
    if (!booked) throw new Error('This time slot is full. Please choose another slot.');
  }

  // Calculate totals
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

  const platformFee = 0; // No platform fee for now
  const totalAmount = subtotal + platformFee;

  const orderNumber = await generateOrderNumber(canteenId);

  // Determine initial status
  let initialStatus: OrderStatus = 'PENDING';
  let paymentStatus: any = 'PENDING';

  if (paymentMethod === 'WALLET') {
    // Check wallet balance
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet || Number(wallet.balance) < totalAmount) {
      if (slotId) await decrementSlotOrders(slotId);
      throw new Error('Insufficient wallet balance. Please recharge.');
    }
    initialStatus = 'CONFIRMED';
    paymentStatus = 'PAID';
  }

  // Create order
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
        platformFee,
        totalAmount,
        specialInstructions,
        items: { create: orderItems },
      },
      include: { items: { include: { menuItem: { select: { name: true } } } }, slot: true },
    });

    if (paymentMethod === 'WALLET' && paymentStatus === 'PAID') {
      const wallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: totalAmount } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          orderId: newOrder.id,
          type: 'DEBIT',
          amount: totalAmount,
          balanceAfter: wallet.balance,
          description: `Order #${orderNumber}`,
        },
      });

      // Generate QR token
      const qrToken = generateQRToken({
        orderId: newOrder.id,
        userId,
        orderNumber,
        canteenId,
      });

      await tx.order.update({ where: { id: newOrder.id }, data: { qrCode: qrToken } });
      return { ...newOrder, qrCode: qrToken };
    }

    return newOrder;
  });

  // Update menu item totalOrders counts
  await prisma.$transaction(
    items.map((item) =>
      prisma.menuItem.update({
        where: { id: item.menuItemId },
        data: { totalOrders: { increment: item.quantity } },
      })
    )
  );

  // Notify vendor of new order
  if (io) {
    io.to(`canteen:${canteenId}`).emit('order:new', { order });
  }

  // Send push notification to student
  await sendOrderNotification(userId, order.id, orderNumber, 'CONFIRMED');

  return order;
}

export async function cancelOrder(orderId: string, cancelledBy: 'student' | 'vendor', reason?: string, io?: any) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { walletTransaction: true },
  });

  if (!order) throw new Error('Order not found');

  if (cancelledBy === 'student' && !['PENDING', 'CONFIRMED'].includes(order.status)) {
    throw new Error('Cannot cancel order that is already being prepared');
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
    });

    // Refund wallet if paid via wallet
    if (order.paymentStatus === 'PAID' && order.paymentMethod === 'WALLET') {
      const wallet = await tx.wallet.update({
        where: { userId: order.userId },
        data: { balance: { increment: Number(order.totalAmount) } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          orderId: order.id,
          type: 'REFUND',
          amount: Number(order.totalAmount),
          balanceAfter: wallet.balance,
          description: `Refund for cancelled order #${order.orderNumber}`,
        },
      });
    }
  });

  // Release slot
  if (order.slotId) await decrementSlotOrders(order.slotId);

  if (io) {
    io.to(`order:${orderId}`).emit('order:status_update', { orderId, status: 'CANCELLED' });
    io.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId, status: 'CANCELLED' });
  }

  await sendOrderNotification(order.userId, orderId, order.orderNumber, 'CANCELLED');
}
