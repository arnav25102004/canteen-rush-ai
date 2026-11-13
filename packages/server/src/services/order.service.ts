import Razorpay from 'razorpay';
import { prisma } from '../config/database';
import { cacheDel, slotCacheKeys } from '../config/redis';
import { generateQRToken } from './qr.service';
import { sendOrderNotification } from './notification.service';
import { validatePointsRedemption, redeemPoints, refundRedeemedPoints } from './loyalty.service';
import { FEATURES } from '../config/features';
import { istDateKey, slotStartsAt, SLOT_CUTOFF_MS } from '../utils/helpers';
import { OrderStatus, PaymentStatus, UserRole } from '@prisma/client';

interface PlaceOrderInput {
  userId: string;
  userRole: UserRole;
  canteenId: string;
  slotId?: string;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, unknown>; notes?: string }>;
  specialInstructions?: string;
  pointsToRedeem?: number;
}

export interface PlaceOrderResult {
  order: Record<string, unknown>;
  razorpay: {
    orderId: string;
    amount: number;   // in paise
    currency: string;
    keyId: string;
  } | null;
  upiAmount: number;
  pointsDiscount: number;
  walletDeduction: number;
  subtotal: number;
}

type IoLike = { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;

/** CC-YYYYMMDD-NNNN from a per-day Postgres counter (atomic upsert, no Redis needed). */
export async function generateOrderNumber(): Promise<string> {
  const date = istDateKey();
  const { seq } = await prisma.orderCounter.upsert({
    where: { date },
    create: { date, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return `CC-${date}-${String(seq).padStart(4, '0')}`;
}

/**
 * How an order is paid, decided by the server only:
 *  - WALLET:   wallet credit + points cover everything → already paid.
 *  - RAZORPAY: online payment; PENDING until the webhook confirms capture.
 *  - CASH:     pay at the counter; unpaid until the vendor scans the pickup QR.
 */
export function decidePayment(totalAmount: number, canteenHasRazorpay: boolean) {
  if (totalAmount === 0) {
    return { paymentMethod: 'WALLET' as const, paymentStatus: 'PAID' as const, status: OrderStatus.CONFIRMED };
  }
  if (FEATURES.RAZORPAY_ENABLED && canteenHasRazorpay) {
    return { paymentMethod: 'RAZORPAY' as const, paymentStatus: 'AWAITING_PAYMENT' as const, status: OrderStatus.PENDING };
  }
  return { paymentMethod: 'CASH' as const, paymentStatus: 'AWAITING_PAYMENT' as const, status: OrderStatus.CONFIRMED };
}

export async function placeOrder(input: PlaceOrderInput, io?: unknown): Promise<PlaceOrderResult> {
  const { userId, userRole, canteenId, slotId, items, specialInstructions, pointsToRedeem = 0 } = input;

  // Validate items belong to this canteen and are available
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.menuItemId) }, canteenId },
    select: { id: true, name: true, price: true, counterPrice: true, isAvailable: true },
  });

  if (menuItems.length !== new Set(items.map((i) => i.menuItemId)).size) {
    throw new Error('One or more items are invalid or belong to a different canteen');
  }

  const unavailable = menuItems.filter((m) => !m.isAvailable);
  if (unavailable.length > 0) {
    throw new Error(`${unavailable.map((m) => m.name).join(', ')} ${unavailable.length > 1 ? 'are' : 'is'} currently unavailable`);
  }

  const canteen = await prisma.canteen.findUnique({
    where: { id: canteenId },
    select: { id: true, name: true, isActive: true, razorpayAccountId: true },
  });
  if (!canteen || !canteen.isActive) throw new Error('Canteen not found');

  // Slot rules: same canteen, not past the cutoff, and capacity left for this user's role.
  // Faculty may also use the faculty-reserved seats; students may not.
  let slotCap = 0;
  if (slotId) {
    const slot = await prisma.pickupSlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.canteenId !== canteenId || !slot.isOpen) {
      throw new Error('This time slot is closed. Please choose another slot.');
    }
    if (slotStartsAt(slot.date, slot.startTime).getTime() - Date.now() < SLOT_CUTOFF_MS) {
      throw new Error('Ordering for this slot has closed. Please choose a later slot.');
    }
    const isFaculty = userRole === UserRole.FACULTY || userRole === UserRole.ADMIN;
    slotCap = slot.maxOrders - slot.walkInReserved - (isFaculty ? 0 : slot.facultyReserved);
    if (slot.currentOrders >= slotCap) throw new Error('This time slot is full. Please choose another slot.');
  }

  const pointsValidation = await validatePointsRedemption(userId, pointsToRedeem);
  if (!pointsValidation.valid) throw new Error(pointsValidation.error || 'Invalid points redemption');
  const pointsDiscount = pointsValidation.discountAmount;

  // Prices always come from the DB, never the client
  let subtotal = 0;
  let totalCounterPrice = 0;
  const orderItems = items.map((item) => {
    const mi = menuItems.find((m) => m.id === item.menuItemId)!;
    const appPrice = Number(mi.price);
    const counterPrice = Number(mi.counterPrice ?? mi.price);
    const totalPrice = appPrice * item.quantity;
    subtotal += totalPrice;
    totalCounterPrice += counterPrice * item.quantity;
    return {
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPrice: appPrice,
      totalPrice,
      customizations: item.customizations ?? {},
      notes: item.notes,
    };
  });

  if (pointsDiscount > subtotal) throw new Error('Points discount is larger than the order total');

  // Wallet credit is applied automatically
  const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { id: true, balance: true } });
  const afterPointsDiscount = subtotal - pointsDiscount;
  const walletDeduction = Math.min(wallet ? Number(wallet.balance) : 0, afterPointsDiscount);
  const totalAmount = Math.max(0, afterPointsDiscount - walletDeduction);

  const { paymentMethod, paymentStatus, status } = decidePayment(totalAmount, !!canteen.razorpayAccountId);
  const orderNumber = await generateOrderNumber();

  const order = await prisma.$transaction(async (tx) => {
    // Conditional updates: a concurrent order can't overbook the slot or overspend the wallet.
    if (slotId) {
      const { count } = await tx.pickupSlot.updateMany({
        where: { id: slotId, isOpen: true, currentOrders: { lt: slotCap } },
        data: { currentOrders: { increment: 1 } },
      });
      if (count === 0) throw new Error('This time slot is now full. Please choose another slot.');
    }

    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        userId,
        canteenId,
        slotId,
        status,
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

    if (walletDeduction > 0 && wallet) {
      const { count } = await tx.wallet.updateMany({
        where: { userId, balance: { gte: walletDeduction } },
        data: { balance: { decrement: walletDeduction } },
      });
      if (count === 0) throw new Error('Your wallet balance changed. Please try again.');
      const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
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

    if (pointsToRedeem > 0) {
      await redeemPoints(tx, userId, newOrder.id, pointsToRedeem, pointsDiscount);
    }

    // QR token the vendor scans at pickup
    const qrToken = generateQRToken({ orderId: newOrder.id, userId, orderNumber, canteenId });
    await tx.order.update({ where: { id: newOrder.id }, data: { qrCode: qrToken } });

    return { ...newOrder, qrCode: qrToken };
  });

  if (slotId) await cacheDel(...slotCacheKeys(slotId));

  // Bump totalOrders counters (non-critical)
  prisma.$transaction(
    items.map((item) =>
      prisma.menuItem.update({ where: { id: item.menuItemId }, data: { totalOrders: { increment: item.quantity } } })
    )
  ).catch((err) => console.error('[Order] Failed to bump totalOrders:', err));

  const ioServer = io as IoLike;

  // Razorpay orders announce themselves from the webhook once payment is captured
  if (paymentMethod !== 'RAZORPAY') {
    ioServer?.to(`canteen:${canteenId}`).emit('order:new', { order });
    await sendOrderNotification(userId, order.id, orderNumber, OrderStatus.CONFIRMED).catch((err) =>
      console.error('[Order] Notification failed:', err)
    );
  }

  let razorpayDetails: PlaceOrderResult['razorpay'] = null;
  if (paymentMethod === 'RAZORPAY') {
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });

    const amountPaise = Math.round(totalAmount * 100);
    // Vendor receives their counter price, capped at what student actually pays
    const counterPaise = Math.min(Math.round(totalCounterPrice * 100), amountPaise);

    // If this throws, the order stays PENDING and the auto-cancel job releases
    // its slot, wallet credit and points after 10 minutes.
    const rzpOrder = await rzp.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `cr_${orderNumber}`.slice(0, 40),
      transfers: [
        {
          account: canteen.razorpayAccountId!,
          amount: counterPaise,
          currency: 'INR',
          on_hold: 0,
        },
      ],
      notes: { canteenId, userId, orderNumber },
    });

    await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: rzpOrder.id } });

    razorpayDetails = {
      orderId: rzpOrder.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID!,
    };
  }

  return {
    order: order as unknown as Record<string, unknown>,
    razorpay: razorpayDetails,
    upiAmount: totalAmount,
    pointsDiscount,
    walletDeduction,
    subtotal,
  };
}

export type CancelActor = 'student' | 'vendor' | 'system';

// Who may cancel from which state. Vendors can't cancel food already being made.
const CANCELLABLE: Record<CancelActor, OrderStatus[]> = {
  student: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.ACCEPTED],
  vendor: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.ACCEPTED],
  system: [OrderStatus.PENDING],
};

/**
 * Money returned on cancel = only what the student really paid:
 *  - wallet credit applied to the order, plus
 *  - the online amount if Razorpay actually captured it.
 * Cash orders were never paid, so nothing is refunded for the cash part.
 */
export function refundableAmount(order: {
  paymentMethod: string;
  paymentStatus: string;
  totalAmount: number;
  walletDebit: number;
}): number {
  const onlinePaid = order.paymentMethod === 'RAZORPAY' && order.paymentStatus === 'PAID' ? order.totalAmount : 0;
  return order.walletDebit + onlinePaid;
}

export async function cancelOrder(
  orderId: string,
  cancelledBy: CancelActor,
  reason?: string,
  io?: unknown,
  opts: { paymentStatus?: PaymentStatus } = {}
) {
  const order = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        status: true, userId: true, canteenId: true, slotId: true, orderNumber: true,
        totalAmount: true, discountAmount: true, paymentStatus: true, paymentMethod: true, pointsRedeemed: true,
        walletTransaction: { select: { type: true, amount: true } },
        user: { select: { isDeleted: true } },
      },
    });
    if (!order) throw new Error('Order not found');

    // Atomic state change: two concurrent cancels can't both pass and double-refund.
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: { in: CANCELLABLE[cancelledBy] } },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
    });
    if (count === 0) {
      throw new Error(cancelledBy === 'student'
        ? 'Cannot cancel an order that is already being prepared'
        : 'Order can no longer be cancelled');
    }

    // Deleted (anonymised) accounts have no wallet or points to refund into.
    const canRefund = !!order.userId && !order.user?.isDeleted;
    const walletDebit = order.walletTransaction?.type === 'DEBIT' ? Number(order.walletTransaction.amount) : 0;
    const refund = canRefund
      ? refundableAmount({
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          totalAmount: Number(order.totalAmount),
          walletDebit,
        })
      : 0;

    if (refund > 0) {
      const wallet = await tx.wallet.upsert({
        where: { userId: order.userId! },
        update: { balance: { increment: refund } },
        create: { userId: order.userId!, balance: refund },
      });
      // No orderId: wallet_transactions.order_id is unique and the DEBIT row already holds it.
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'REFUND',
          amount: refund,
          balanceAfter: wallet.balance,
          description: `Refund for cancelled Order #${order.orderNumber}`,
        },
      });
    }

    if (canRefund && order.pointsRedeemed > 0) {
      await refundRedeemedPoints(
        tx, order.userId!, orderId, order.pointsRedeemed, Number(order.discountAmount), order.orderNumber
      );
    }

    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: opts.paymentStatus ?? (refund > 0 ? 'REFUNDED' : 'EXPIRED') },
    });

    if (order.slotId) {
      await tx.pickupSlot.updateMany({
        where: { id: order.slotId, currentOrders: { gt: 0 } },
        data: { currentOrders: { decrement: 1 } },
      });
    }
    return order;
  });

  if (order.slotId) await cacheDel(...slotCacheKeys(order.slotId));

  const ioServer = io as IoLike;
  ioServer?.to(`order:${orderId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });
  ioServer?.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });

  if (order.userId) {
    await sendOrderNotification(order.userId, orderId, order.orderNumber, OrderStatus.CANCELLED).catch((err) =>
      console.error('[Order] Notification failed:', err)
    );
  }
}
