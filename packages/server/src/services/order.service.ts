import { prisma } from '../config/database';
import { redis, KEYS, incrOrderSeq } from '../config/redis';
import { generateQRToken } from './qr.service';
import { sendOrderNotification } from './notification.service';
import { validatePointsRedemption, redeemPoints } from './loyalty.service';
import { OrderStatus } from '@prisma/client';

interface PlaceOrderInput {
  userId: string;
  canteenId: string;
  slotId?: string;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, unknown>; notes?: string }>;
  specialInstructions?: string;
  pointsToRedeem?: number;
}

export interface PlaceOrderResult {
  order: Record<string, unknown>;
  payment: {
    vpa: string;
    payeeName: string;
    amount: string;
    transactionRef: string;
    transactionNote: string;
  } | null;
  upiAmount: number;
  pointsDiscount: number;
  walletDeduction: number;
  subtotal: number;
}

export async function generateOrderNumber(_canteenId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    const seq = await incrOrderSeq(today);
    return `CC-${today}-${String(seq).padStart(4, '0')}`;
  } catch {
    return `CC-${today}-${Date.now().toString().slice(-4)}`;
  }
}

export async function placeOrder(input: PlaceOrderInput, io?: unknown): Promise<PlaceOrderResult> {
  const { userId, canteenId, slotId, items, specialInstructions, pointsToRedeem = 0 } = input;

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

  // Check canteen has UPI configured
  const canteen = await prisma.canteen.findUnique({
    where: { id: canteenId },
    select: { id: true, name: true, vendorUpiId: true, vendorUpiName: true },
  });
  if (!canteen) throw new Error('Canteen not found');
  if (!canteen.vendorUpiId) {
    throw new Error('This canteen has not set up UPI payments yet. Please contact the vendor.');
  }

  // Pre-validate slot
  if (slotId) {
    const slot = await prisma.pickupSlot.findUnique({
      where: { id: slotId },
      select: { maxOrders: true, walkInReserved: true, currentOrders: true, isOpen: true },
    });
    if (!slot || !slot.isOpen) throw new Error('This time slot is closed. Please choose another slot.');
    const preOrderCap = slot.maxOrders - slot.walkInReserved;
    if (slot.currentOrders >= preOrderCap) throw new Error('This time slot is full. Please choose another slot.');
  }

  // Validate points redemption
  const pointsValidation = await validatePointsRedemption(userId, pointsToRedeem);
  if (!pointsValidation.valid) throw new Error(pointsValidation.error || 'Invalid points redemption');
  const pointsDiscount = pointsValidation.discountAmount;

  // Calculate subtotal from DB prices
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

  // Apply wallet credit (refund balance) automatically
  const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { id: true, balance: true } });
  const walletCredit = wallet ? Number(wallet.balance) : 0;
  const afterPointsDiscount = subtotal - pointsDiscount;
  const walletDeduction = Math.min(walletCredit, afterPointsDiscount);
  const upiAmount = Math.max(0, afterPointsDiscount - walletDeduction);
  const totalAmount = upiAmount; // what actually needs to be paid via UPI (wallet already applied)

  const orderNumber = await generateOrderNumber(canteenId);
  const paymentMethod = upiAmount > 0 ? 'UPI_DIRECT' : 'WALLET';
  const paymentStatus = upiAmount > 0 ? 'AWAITING_PAYMENT' : 'PAID';
  const orderStatus = upiAmount > 0 ? OrderStatus.PENDING : OrderStatus.CONFIRMED;

  const order = await prisma.$transaction(async (tx) => {
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

    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        userId,
        canteenId,
        slotId,
        status: orderStatus,
        paymentMethod,
        paymentStatus,
        subtotal,
        platformFee: 0,
        discountAmount: pointsDiscount,
        totalAmount,
        upiOrderNote: orderNumber,
        specialInstructions,
        pointsRedeemed: pointsToRedeem,
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

    // Deduct wallet credit if used
    if (walletDeduction > 0 && wallet) {
      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: walletDeduction } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          orderId: newOrder.id,
          type: 'DEBIT',
          amount: walletDeduction,
          balanceAfter: updatedWallet.balance,
          description: `Applied to Order #${orderNumber}`,
        },
      });
    }

    // Deduct loyalty points if redeemed
    if (pointsToRedeem > 0) {
      await redeemPoints(userId, newOrder.id, pointsToRedeem, pointsDiscount);
    }

    // Reserve slot
    if (slotId) {
      await tx.pickupSlot.update({ where: { id: slotId }, data: { currentOrders: { increment: 1 } } });
    }

    // Generate QR token (available after vendor verifies payment)
    const qrToken = generateQRToken({ orderId: newOrder.id, userId, orderNumber, canteenId });
    await tx.order.update({ where: { id: newOrder.id }, data: { qrCode: qrToken } });

    return { ...newOrder, qrCode: qrToken };
  });

  if (slotId) await redis.del(KEYS.slotAvailability(slotId));

  // Bump totalOrders counters (non-critical)
  await prisma.$transaction(
    items.map((item) =>
      prisma.menuItem.update({ where: { id: item.menuItemId }, data: { totalOrders: { increment: item.quantity } } })
    )
  );

  const ioServer = io as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;

  // If fully paid (wallet/points covered all), notify vendor immediately
  if (upiAmount <= 0) {
    ioServer?.to(`canteen:${canteenId}`).emit('order:new', { order });
    await sendOrderNotification(userId, order.id, orderNumber, OrderStatus.CONFIRMED);
  }

  const payment = upiAmount > 0 ? {
    vpa: canteen.vendorUpiId!,
    payeeName: canteen.vendorUpiName || canteen.name,
    amount: upiAmount.toFixed(2),
    transactionRef: `CR${Date.now()}`,
    transactionNote: orderNumber,
  } : null;

  return { order: order as unknown as Record<string, unknown>, payment, upiAmount, pointsDiscount, walletDeduction, subtotal };
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
      totalAmount: true, paymentStatus: true, orderNumber: true, paymentMethod: true,
    },
  });

  if (!order) throw new Error('Order not found');

  const cancellableStatuses: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.ACCEPTED, OrderStatus.PENDING];
  if (cancelledBy === 'student' && !cancellableStatuses.includes(order.status)) {
    throw new Error('Cannot cancel an order that is already being prepared');
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        paymentStatus: 'EXPIRED',
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });

    // Refund wallet for orders where payment was verified (UPI) or wallet-paid
    const shouldRefund =
      order.paymentStatus === 'VERIFIED' ||
      order.paymentStatus === 'PAID';

    if (shouldRefund) {
      const wallet = await tx.wallet.upsert({
        where: { userId: order.userId },
        update: { balance: { increment: Number(order.totalAmount) } },
        create: { userId: order.userId, balance: Number(order.totalAmount) },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          orderId,
          type: 'REFUND',
          amount: Number(order.totalAmount),
          balanceAfter: wallet.balance,
          description: `Refund for cancelled Order #${order.orderNumber}`,
        },
      });
    }
  });

  if (order.slotId) {
    await prisma.pickupSlot.update({ where: { id: order.slotId }, data: { currentOrders: { decrement: 1 } } });
    await redis.del(KEYS.slotAvailability(order.slotId));
  }

  const ioServer = io as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
  ioServer?.to(`order:${orderId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });
  ioServer?.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });

  await sendOrderNotification(order.userId, orderId, order.orderNumber, OrderStatus.CANCELLED);
}
