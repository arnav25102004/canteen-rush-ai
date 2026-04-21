import { prisma } from '../config/database';
import { redis, KEYS, incrOrderSeq } from '../config/redis';
import { generateQRToken } from './qr.service';
import { sendOrderNotification } from './notification.service';
import { OrderStatus } from '@prisma/client';

interface PlaceOrderInput {
  userId: string;
  canteenId: string;
  slotId?: string;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, unknown>; notes?: string }>;
  specialInstructions?: string;
}

export async function generateOrderNumber(canteenId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = await incrOrderSeq(today);
  return `CC-${today}-${String(seq).padStart(4, '0')}`;
}

export async function placeOrder(input: PlaceOrderInput, io?: unknown) {
  const { userId, canteenId, slotId, items, specialInstructions } = input;

  // Validate items belong to this canteen and are available
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) }, canteenId },
    select: { id: true, name: true, price: true, isAvailable: true },
  });

  if (menuItems.length !== items.length) {
    throw new Error('One or more items are invalid or belong to a different canteen');
  }

  const unavailable = menuItems.filter((m) => !m.isAvailable);
  if (unavailable.length > 0) {
    throw new Error(`${unavailable.map((m) => m.name).join(', ')} ${unavailable.length > 1 ? 'are' : 'is'} currently unavailable`);
  }

  // Pre-validate slot (read-only check before transaction)
  if (slotId) {
    const slot = await prisma.pickupSlot.findUnique({
      where: { id: slotId },
      select: { maxOrders: true, walkInReserved: true, currentOrders: true, isOpen: true },
    });
    if (!slot || !slot.isOpen) throw new Error('This time slot is closed. Please choose another slot.');
    const preOrderCap = slot.maxOrders - slot.walkInReserved;
    if (slot.currentOrders >= preOrderCap) throw new Error('This time slot is full. Please choose another slot.');
  }

  // Calculate totals from database prices
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

  const totalAmount = subtotal;
  const orderNumber = await generateOrderNumber(canteenId);

  // Single atomic transaction: balance check + order creation + debit + slot reservation
  const order = await prisma.$transaction(async (tx) => {
    // Re-check wallet inside transaction to prevent race conditions
    const wallet = await tx.wallet.findUnique({ where: { userId }, select: { id: true, balance: true } });
    if (!wallet) throw new Error('Wallet not found. Please contact support.');
    if (Number(wallet.balance) < totalAmount) {
      throw new Error(`INSUFFICIENT_BALANCE:${wallet.balance}:${totalAmount}`);
    }

    // Re-check slot inside transaction
    if (slotId) {
      const slot = await tx.pickupSlot.findUnique({
        where: { id: slotId },
        select: { maxOrders: true, walkInReserved: true, currentOrders: true, isOpen: true },
      });
      if (!slot || !slot.isOpen) throw new Error('This time slot is closed.');
      const preOrderCap = slot.maxOrders - slot.walkInReserved;
      if (slot.currentOrders >= preOrderCap) throw new Error('This time slot is now full. Please choose another slot.');
    }

    // Create the order
    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        userId,
        canteenId,
        slotId,
        status: OrderStatus.CONFIRMED,
        paymentStatus: 'PAID',
        paymentMethod: 'WALLET',
        subtotal,
        platformFee: 0,
        totalAmount,
        specialInstructions,
        items: {
          create: orderItems.map((oi) => ({
            menuItem: { connect: { id: oi.menuItemId } },
            quantity: oi.quantity,
            unitPrice: oi.unitPrice,
            totalPrice: oi.totalPrice,
            customizations: oi.customizations as object,
            notes: oi.notes,
          })),
        },
      },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        slot: { select: { startTime: true, endTime: true } },
      },
    });

    // Deduct wallet
    const updatedWallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { decrement: totalAmount } },
    });

    // Log wallet transaction
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        orderId: newOrder.id,
        type: 'DEBIT',
        amount: totalAmount,
        balanceAfter: updatedWallet.balance,
        description: `Order #${orderNumber}`,
      },
    });

    // Reserve slot
    if (slotId) {
      await tx.pickupSlot.update({
        where: { id: slotId },
        data: { currentOrders: { increment: 1 } },
      });
    }

    // Generate QR token and store it
    const qrToken = generateQRToken({ orderId: newOrder.id, userId, orderNumber, canteenId });
    await tx.order.update({ where: { id: newOrder.id }, data: { qrCode: qrToken } });

    return { ...newOrder, qrCode: qrToken };
  });

  // Invalidate slot cache after transaction
  if (slotId) await redis.del(KEYS.slotAvailability(slotId));

  // Bump totalOrders counters (non-critical, best effort)
  await prisma.$transaction(
    items.map((item) =>
      prisma.menuItem.update({
        where: { id: item.menuItemId },
        data: { totalOrders: { increment: item.quantity } },
      })
    )
  );

  // Real-time + push notification
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
    select: {
      status: true, userId: true, canteenId: true, slotId: true,
      totalAmount: true, paymentStatus: true, orderNumber: true,
    },
  });

  if (!order) throw new Error('Order not found');

  const cancellableStatuses: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.ACCEPTED];
  if (cancelledBy === 'student' && !cancellableStatuses.includes(order.status)) {
    throw new Error('Cannot cancel an order that is already being prepared');
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
    });

    // Refund wallet for paid wallet orders
    if (order.paymentStatus === 'PAID') {
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

  // Decrement slot and invalidate cache
  if (order.slotId) {
    await prisma.pickupSlot.update({
      where: { id: order.slotId },
      data: { currentOrders: { decrement: 1 } },
    });
    await redis.del(KEYS.slotAvailability(order.slotId));
  }

  const ioServer = io as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  ioServer?.to(`order:${orderId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });
  ioServer?.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });

  await sendOrderNotification(order.userId, orderId, order.orderNumber, OrderStatus.CANCELLED);
}
