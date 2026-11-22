import { AppError } from '../utils/errors';
import Razorpay from 'razorpay';
import { randomUUID } from 'crypto';
import { prisma } from '../config/database';
import { generateQRToken } from './qr.service';
import { enqueue, enqueueMany, OutboxEvent } from './outbox.service';
import { invalidateSlots } from './catalogCache.service';
import { withTimeout } from '../middleware/resilience';
import { validatePointsRedemption, redeemPoints, refundRedeemedPoints } from './loyalty.service';
import { FEATURES } from '../config/features';
import { generatePickupCode, istDateKey, slotStartsAt, SLOT_CUTOFF_MS, NO_SHOW_GRACE_MS, NO_SHOW_STRIKE_LIMIT, NO_SHOW_BAN_MS } from '../utils/helpers';
import { logger } from '../utils/logger';
import { OrderStatus, PaymentMethod, Prisma, UserRole } from '@prisma/client';

interface PlaceOrderInput {
  userId: string;
  userRole: UserRole;
  canteenId: string;
  slotId?: string;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, unknown>; notes?: string }>;
  specialInstructions?: string;
  pointsToRedeem?: number;
  /** Client-generated per checkout attempt, so a retried request cannot order twice. */
  clientRequestId?: string;
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

/**
 * CC-YYYYMMDD-NNNN from a Postgres sequence. nextval never blocks, unlike a shared
 * counter row, so order placement has no global write hot spot. The number keeps
 * rising across days and may have gaps.
 */
export async function generateOrderNumber(): Promise<string> {
  const [{ seq }] = await prisma.$queryRaw<Array<{ seq: bigint }>>`SELECT nextval('order_number_seq') AS seq`;
  return `CC-${istDateKey()}-${String(seq).padStart(4, '0')}`;
}

const ORDER_RESPONSE_INCLUDE = {
  items: { include: { menuItem: { select: { name: true } } } },
  slot: { select: { startTime: true, endTime: true } },
} satisfies Prisma.OrderInclude;

/** Creates the Razorpay order and stores its id. If a concurrent request stored one first, that one is used. */
async function attachRazorpayOrder(
  order: { id: string; orderNumber: string; userId: string; canteenId: string; totalAmount: number },
  razorpayAccountId: string,
  totalCounterPrice: number,
): Promise<NonNullable<PlaceOrderResult['razorpay']>> {
  const rzp = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
  const amountPaise = Math.round(order.totalAmount * 100);
  // Vendor receives their counter price, capped at what student actually pays
  const counterPaise = Math.min(Math.round(totalCounterPrice * 100), amountPaise);

  const rzpOrder = await withTimeout(rzp.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt: `cr_${order.orderNumber}`.slice(0, 40),
    transfers: [
      {
        account: razorpayAccountId,
        amount: counterPaise,
        currency: 'INR',
        on_hold: 0,
      },
    ],
    notes: { canteenId: order.canteenId, userId: order.userId, orderNumber: order.orderNumber },
  }), 10_000, 'Razorpay order');

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, razorpayOrderId: null },
    data: { razorpayOrderId: rzpOrder.id },
  });
  const orderId = count === 1
    ? rzpOrder.id
    : (await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { razorpayOrderId: true } })).razorpayOrderId!;
  return { orderId, amount: amountPaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID! };
}

/**
 * The original result for a repeated clientRequestId. Payment details are returned only
 * while the order still awaits payment. If the first attempt committed the order but
 * failed to reach Razorpay, the retry creates the missing Razorpay order.
 */
async function findPlacedOrder(userId: string, idempotencyKey: string): Promise<PlaceOrderResult | null> {
  const order = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: { ...ORDER_RESPONSE_INCLUDE, walletTransaction: { select: { type: true, amount: true } } },
  });
  if (!order) return null;
  const { walletTransaction, ...rest } = order;
  const totalAmount = Number(order.totalAmount);

  let razorpay: PlaceOrderResult['razorpay'] = null;
  if (order.paymentMethod === 'RAZORPAY' && order.status === OrderStatus.PENDING && order.paymentStatus === 'AWAITING_PAYMENT') {
    if (order.razorpayOrderId) {
      razorpay = { orderId: order.razorpayOrderId, amount: Math.round(totalAmount * 100), currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID! };
    } else {
      const source = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          canteen: { select: { razorpayAccountId: true } },
          items: { select: { quantity: true, menuItem: { select: { price: true, counterPrice: true } } } },
        },
      });
      if (source.canteen.razorpayAccountId) {
        const totalCounterPrice = source.items.reduce(
          (sum, i) => sum + Number(i.menuItem.counterPrice ?? i.menuItem.price) * i.quantity, 0,
        );
        razorpay = await attachRazorpayOrder(
          { id: order.id, orderNumber: order.orderNumber, userId, canteenId: order.canteenId, totalAmount },
          source.canteen.razorpayAccountId,
          totalCounterPrice,
        );
      }
    }
  }

  return {
    order: rest as unknown as Record<string, unknown>,
    razorpay,
    upiAmount: totalAmount,
    pointsDiscount: Number(order.discountAmount),
    walletDeduction: walletTransaction?.type === 'DEBIT' ? Number(walletTransaction.amount) : 0,
    subtotal: Number(order.subtotal),
  };
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

export interface OrderDraft {
  userRole: UserRole;
  canteenId: string;
  slotId?: string | null;
  items: Array<{ menuItemId: string; quantity: number; customizations?: Record<string, unknown>; notes?: string }>;
  /** When set, the canteen must belong to this institution (used by the assistant). */
  institutionId?: string;
}

export interface OrderQuote {
  canteen: { id: string; name: string; isActive: boolean; razorpayAccountId: string | null; institutionId: string };
  slot: { id: string; date: Date; startTime: string; endTime: string } | null;
  slotCap: number;
  lines: Array<{
    menuItemId: string;
    name: string;
    isVeg: boolean;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    counterUnitPrice: number;
    customizations: Record<string, unknown>;
    notes?: string;
  }>;
  subtotal: number;
  totalCounterPrice: number;
}

/**
 * Read-only validation and pricing of an order draft: items, canteen, slot rules and
 * DB prices. Throws the same AppErrors placeOrder always has. Writes nothing.
 */
export async function quoteOrder(draft: OrderDraft): Promise<OrderQuote> {
  const { userRole, canteenId, items } = draft;
  const slotId = draft.slotId ?? undefined;

  // Validate items belong to this canteen and are available
  const [menuItems, canteen, slot] = await Promise.all([
    prisma.menuItem.findMany({
      where: { id: { in: items.map((i) => i.menuItemId) }, canteenId },
      select: { id: true, name: true, price: true, counterPrice: true, isAvailable: true, isVeg: true },
    }),
    prisma.canteen.findUnique({
      where: { id: canteenId },
      select: { id: true, name: true, isActive: true, razorpayAccountId: true, institutionId: true },
    }),
    slotId ? prisma.pickupSlot.findUnique({ where: { id: slotId } }) : null,
  ]);

  if (menuItems.length !== new Set(items.map((i) => i.menuItemId)).size) {
    throw new AppError(400, 'One or more items are invalid or belong to a different canteen');
  }

  const unavailable = menuItems.filter((m) => !m.isAvailable);
  if (unavailable.length > 0) {
    throw new AppError(400, `${unavailable.map((m) => m.name).join(', ')} ${unavailable.length > 1 ? 'are' : 'is'} currently unavailable`);
  }

  if (!canteen || !canteen.isActive) throw new AppError(404, 'Canteen not found');
  if (draft.institutionId && canteen.institutionId !== draft.institutionId) throw new AppError(404, 'Canteen not found');

  // Slot rules: same canteen, not past the cutoff, and capacity left for this user's role.
  // Faculty may also use the faculty-reserved seats; students may not.
  let slotCap = 0;
  let slotInfo: OrderQuote['slot'] = null;
  if (slotId) {
    if (!slot || slot.canteenId !== canteenId || !slot.isOpen) {
      throw new AppError(400, 'This time slot is closed. Please choose another slot.');
    }
    if (slotStartsAt(slot.date, slot.startTime).getTime() - Date.now() < SLOT_CUTOFF_MS) {
      throw new AppError(400, 'Ordering for this slot has closed. Please choose a later slot.');
    }
    const isFaculty = userRole === UserRole.FACULTY || userRole === UserRole.ADMIN;
    slotCap = slot.maxOrders - slot.walkInReserved - (isFaculty ? 0 : slot.facultyReserved);
    if (slot.currentOrders >= slotCap) throw new AppError(400, 'This time slot is full. Please choose another slot.');
    slotInfo = { id: slot.id, date: slot.date, startTime: slot.startTime, endTime: slot.endTime };
  }

  // Prices always come from the DB, never the client
  let subtotal = 0;
  let totalCounterPrice = 0;
  const lines = items.map((item) => {
    const mi = menuItems.find((m) => m.id === item.menuItemId)!;
    const appPrice = Number(mi.price);
    const counterPrice = Number(mi.counterPrice ?? mi.price);
    const totalPrice = appPrice * item.quantity;
    subtotal += totalPrice;
    totalCounterPrice += counterPrice * item.quantity;
    return {
      menuItemId: item.menuItemId,
      name: mi.name,
      isVeg: mi.isVeg,
      quantity: item.quantity,
      unitPrice: appPrice,
      totalPrice,
      counterUnitPrice: counterPrice,
      customizations: (item.customizations ?? {}) as Record<string, unknown>,
      notes: item.notes,
    };
  });

  return { canteen, slot: slotInfo, slotCap, lines, subtotal, totalCounterPrice };
}

/** Throws 403 while the user is temporarily blocked from ordering after repeated no-shows. */
export async function assertNotStrikeBanned(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { orderStrikes: true, strikeBannedUntil: true },
  });
  if (user?.strikeBannedUntil && user.strikeBannedUntil > new Date()) {
    const until = user.strikeBannedUntil.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    throw new AppError(403, `You've been temporarily blocked from ordering after repeated no-shows until ${until}.`);
  }
}

/** Most recent non-cancelled orders for a user, newest first, with canteen and item details. */
export async function findRecentOrdersForUser(userId: string, limit: number) {
  return prisma.order.findMany({
    where: { userId, status: { notIn: [OrderStatus.CANCELLED] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      canteen: { select: { id: true, name: true, imageUrl: true, isActive: true } },
      items: { include: { menuItem: { select: { id: true, name: true, imageUrl: true, price: true, isAvailable: true, isVeg: true } } } },
    },
  });
}

export async function placeOrder(input: PlaceOrderInput, io?: unknown): Promise<PlaceOrderResult> {
  const { userId, userRole, canteenId, slotId, items, specialInstructions, pointsToRedeem = 0, clientRequestId } = input;

  // Checked first: a retry must get its order back even if the slot has since filled.
  if (clientRequestId) {
    const existing = await findPlacedOrder(userId, clientRequestId);
    if (existing) return existing;
  }

  const quote = await quoteOrder({ userRole, canteenId, slotId, items });
  const { canteen, slotCap, subtotal, totalCounterPrice } = quote;
  const orderId = randomUUID();
  const orderItems = quote.lines.map((l) => ({
    id: randomUUID(),
    orderId,
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    totalPrice: l.totalPrice,
    customizations: l.customizations as Prisma.InputJsonValue,
    notes: l.notes,
  }));

  const [pointsValidation, wallet] = await Promise.all([
    validatePointsRedemption(userId, pointsToRedeem),
    prisma.wallet.findUnique({ where: { userId }, select: { id: true, balance: true } }),
  ]);
  if (!pointsValidation.valid) throw new AppError(400, pointsValidation.error || 'Invalid points redemption');
  const pointsDiscount = pointsValidation.discountAmount;

  if (pointsDiscount > subtotal) throw new AppError(400, 'Points discount is larger than the order total');

  // Wallet credit is applied automatically
  const afterPointsDiscount = subtotal - pointsDiscount;
  const walletDeduction = Math.min(wallet ? Number(wallet.balance) : 0, afterPointsDiscount);
  const totalAmount = Math.max(0, afterPointsDiscount - walletDeduction);

  const { paymentMethod, paymentStatus, status } = decidePayment(totalAmount, !!canteen.razorpayAccountId);
  const orderNumber = await generateOrderNumber();

  // QR token the vendor scans at pickup
  const qrToken = generateQRToken({ orderId, userId, orderNumber, canteenId });

  // Razorpay orders get their code from the webhook once payment is captured.
  const pickupCode = paymentMethod === 'RAZORPAY' ? null : generatePickupCode();
  const events: OutboxEvent[] = [
    { type: 'menu.totalOrders', payload: { items: items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })) } },
    // Razorpay orders announce themselves from the webhook once payment is captured
    ...(paymentMethod !== 'RAZORPAY'
      ? [{ type: 'notification.order' as const, payload: { userId, orderId, orderNumber, status: OrderStatus.CONFIRMED } }]
      : []),
  ];
  // Built from what was just written, so the response needs no item or slot queries.
  const withDetails = <T extends object>(row: T) => ({
    ...row,
    items: orderItems.map((item, i) => ({ ...item, menuItem: { name: quote.lines[i].name } })),
    slot: quote.slot ? { startTime: quote.slot.startTime, endTime: quote.slot.endTime } : null,
  });

  let order;
  try {
    if (walletDeduction === 0 && pointsToRedeem === 0) {
      // No wallet or points to move: the slot claim and every insert commit as one statement,
      // so the contended slot row is locked for a single database round trip.
      const [{ placed }] = await prisma.$queryRaw<Array<{ placed: number }>>(Prisma.sql`
        WITH slot_claim AS (
          UPDATE pickup_slots SET current_orders = current_orders + 1
          WHERE id = ${slotId ?? null}::text AND is_open AND current_orders < ${slotCap}::int
          RETURNING id
        ), new_order AS (
          INSERT INTO orders (
            id, idempotency_key, qr_code, pickup_code, order_number, user_id, canteen_id, slot_id, status,
            payment_method, payment_status, subtotal, platform_fee, discount_amount, total_amount,
            upi_order_note, special_instructions, points_redeemed, updated_at
          )
          SELECT
            ${orderId}::text, ${clientRequestId ?? null}::text, ${qrToken}::text, ${pickupCode}::text, ${orderNumber}::text,
            ${userId}::text, ${canteenId}::text, ${slotId ?? null}::text, ${status}::"OrderStatus",
            ${paymentMethod}::"PaymentMethod", ${paymentStatus}::"PaymentStatus", ${subtotal}::numeric, 0, 0, ${totalAmount}::numeric,
            ${orderNumber}::text, ${specialInstructions ?? null}::text, 0, now()
          WHERE ${slotId ? Prisma.sql`EXISTS (SELECT 1 FROM slot_claim)` : Prisma.sql`TRUE`}
          RETURNING id
        ), new_items AS (
          INSERT INTO order_items (id, order_id, menu_item_id, quantity, unit_price, total_price, customizations, notes)
          SELECT x.id, o.id, x."menuItemId", x.quantity, x."unitPrice", x."totalPrice", COALESCE(x.customizations, '{}'::jsonb), x.notes
          FROM new_order o
          CROSS JOIN jsonb_to_recordset(${JSON.stringify(orderItems)}::jsonb) AS x(
            id text, "menuItemId" text, quantity int, "unitPrice" numeric, "totalPrice" numeric, customizations jsonb, notes text
          )
        ), new_events AS (
          INSERT INTO outbox_events (type, payload)
          SELECT e.type, e.payload
          FROM new_order
          CROSS JOIN jsonb_to_recordset(${JSON.stringify(events)}::jsonb) AS e(type text, payload jsonb)
        )
        SELECT count(*)::int AS placed FROM new_order`);
      if (placed === 0) throw new AppError(400, 'This time slot is now full. Please choose another slot.');
      order = withDetails(await prisma.order.findUniqueOrThrow({ where: { id: orderId } }));
    } else {
    order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        id: orderId,
        idempotencyKey: clientRequestId,
        qrCode: qrToken,
        pickupCode,
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
      },
    });
    await tx.orderItem.createMany({ data: orderItems });

    if (walletDeduction > 0 && wallet) {
      const { count } = await tx.wallet.updateMany({
        where: { userId, balance: { gte: walletDeduction } },
        data: { balance: { decrement: walletDeduction } },
      });
      if (count === 0) throw new AppError(400, 'Your wallet balance changed. Please try again.');
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

    await enqueueMany(tx, events);

    // Last, so the contended slot row is locked for the shortest time possible.
    // Conditional updates: a concurrent order can't overbook the slot or overspend the wallet.
    if (slotId) {
      const { count } = await tx.pickupSlot.updateMany({
        where: { id: slotId, isOpen: true, currentOrders: { lt: slotCap } },
        data: { currentOrders: { increment: 1 } },
      });
      if (count === 0) throw new AppError(400, 'This time slot is now full. Please choose another slot.');
    }

    return withDetails(newOrder);
    });
    }
  } catch (err) {
    // Two copies of the same request raced: the loser returns the winner's order.
    const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && (
      (err.code === 'P2002' && String(err.meta?.target).includes('idempotency_key'))
      || (err.code === 'P2010' && err.message.includes('(user_id, idempotency_key)'))
    );
    if (clientRequestId && duplicate) {
      const winner = await findPlacedOrder(userId, clientRequestId);
      if (winner) return winner;
    }
    throw err;
  }

  if (quote.slot) await invalidateSlots(canteenId, quote.slot.date);

  const ioServer = io as IoLike;

  // Razorpay orders announce themselves from the webhook once payment is captured
  if (paymentMethod !== 'RAZORPAY') {
    ioServer?.to(`canteen:${canteenId}`).emit('order:new', { order });
  }

  // If this throws, the order stays PENDING. A retry with the same clientRequestId
  // creates the Razorpay order; otherwise auto-cancel releases it after 10 minutes.
  const razorpayDetails = paymentMethod === 'RAZORPAY'
    ? await attachRazorpayOrder(
        { id: order.id, orderNumber, userId, canteenId, totalAmount },
        canteen.razorpayAccountId!,
        totalCounterPrice,
      )
    : null;

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
) {
  const order = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        status: true, userId: true, canteenId: true, slotId: true, orderNumber: true,
        totalAmount: true, discountAmount: true, paymentStatus: true, paymentMethod: true, pointsRedeemed: true,
        walletTransaction: { select: { type: true, amount: true } },
        user: { select: { isDeleted: true } },
        slot: { select: { date: true } },
      },
    });
    if (!order) throw new AppError(404, 'Order not found');

    // Atomic state change: two concurrent cancels can't both pass and double-refund.
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: { in: CANCELLABLE[cancelledBy] } },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
    });
    if (count === 0) {
      throw new AppError(400, cancelledBy === 'student'
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
      data: { paymentStatus: refund > 0 ? 'REFUNDED' : 'EXPIRED' },
    });

    if (order.slotId) {
      await tx.pickupSlot.updateMany({
        where: { id: order.slotId, currentOrders: { gt: 0 } },
        data: { currentOrders: { decrement: 1 } },
      });
    }
    if (order.userId) {
      await enqueue(tx, {
        type: 'notification.order',
        payload: { userId: order.userId, orderId, orderNumber: order.orderNumber, status: OrderStatus.CANCELLED },
      });
    }
    return order;
  });

  if (order.slot) await invalidateSlots(order.canteenId, order.slot.date);

  const ioServer = io as IoLike;
  ioServer?.to(`order:${orderId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });
  ioServer?.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId, status: OrderStatus.CANCELLED });
}

// Orders paid at the counter, or fully covered by wallet credit / points
// (totalAmount 0 -> WALLET). Online (Razorpay) orders are excluded: refunding
// them would need a card refund, which isn't built while Razorpay is off.
const NO_SHOW_METHODS: PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.WALLET];

const NO_SHOW_ELIGIBLE: OrderStatus[] = [
  OrderStatus.CONFIRMED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY,
];

/**
 * Expires one uncollected cash order: releases the slot, returns redeemed points
 * and the wallet portion actually debited (never the cash part), and adds a strike.
 * The guarded updateMany makes it safe to run concurrently / repeatedly.
 * Returns false when the order was no longer eligible.
 */
export async function markOrderNoShow(orderId: string): Promise<boolean> {
  const order = await prisma.$transaction(async (tx) => {
    const before = await tx.order.findFirst({
      where: { id: orderId, paymentMethod: { in: NO_SHOW_METHODS }, status: { in: NO_SHOW_ELIGIBLE } },
      select: { status: true },
    });
    if (!before) return null;
    // Only a READY order means the food was made and the student never came.
    // Earlier states mean the canteen never finished it: expire, but no strike.
    const studentAtFault = before.status === OrderStatus.READY;

    const { count } = await tx.order.updateMany({
      // Guard on the exact status we read so a concurrent transition wins cleanly.
      where: { id: orderId, paymentMethod: { in: NO_SHOW_METHODS }, status: before.status },
      data: {
        status: OrderStatus.NO_SHOW,
        cancelledAt: new Date(),
        cancelReason: studentAtFault
          ? 'No-show: order not collected after its pickup slot ended'
          : 'Expired: order was not completed before its pickup slot ended',
      },
    });
    if (count === 0) return null;

    const o = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        userId: true, canteenId: true, slotId: true, orderNumber: true, discountAmount: true,
        pointsRedeemed: true, paymentMethod: true, paymentStatus: true, totalAmount: true,
        walletTransaction: { select: { type: true, amount: true } },
        user: { select: { isDeleted: true } },
        slot: { select: { date: true } },
      },
    });

    const canRefund = !!o.userId && !o.user?.isDeleted;
    const walletDebit = o.walletTransaction?.type === 'DEBIT' ? Number(o.walletTransaction.amount) : 0;
    if (canRefund && walletDebit > 0) {
      const wallet = await tx.wallet.upsert({
        where: { userId: o.userId! },
        update: { balance: { increment: walletDebit } },
        create: { userId: o.userId!, balance: walletDebit },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'REFUND',
          amount: walletDebit,
          balanceAfter: wallet.balance,
          description: `Wallet credit returned for no-show Order #${o.orderNumber}`,
        },
      });
    }
    if (canRefund && o.pointsRedeemed > 0) {
      await refundRedeemedPoints(
        tx, o.userId!, orderId, o.pointsRedeemed, Number(o.discountAmount), o.orderNumber
      );
    }

    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: canRefund && walletDebit > 0 ? 'REFUNDED' : 'EXPIRED' },
    });

    if (o.slotId) {
      await tx.pickupSlot.updateMany({
        where: { id: o.slotId, currentOrders: { gt: 0 } },
        data: { currentOrders: { decrement: 1 } },
      });
    }

    if (o.userId && studentAtFault) {
      const u = await tx.user.update({
        where: { id: o.userId },
        data: { orderStrikes: { increment: 1 } },
        select: { orderStrikes: true },
      });
      if (u.orderStrikes >= NO_SHOW_STRIKE_LIMIT) {
        await tx.user.update({
          where: { id: o.userId },
          data: { orderStrikes: 0, strikeBannedUntil: new Date(Date.now() + NO_SHOW_BAN_MS) },
        });
      }
    }
    if (o.userId) {
      await enqueue(tx, {
        type: 'notification.order',
        payload: { userId: o.userId, orderId, orderNumber: o.orderNumber, status: OrderStatus.NO_SHOW },
      });
    }
    return o;
  });

  if (!order) return false;
  if (order.slot) await invalidateSlots(order.canteenId, order.slot.date);
  return true;
}

/** Finds counter/wallet-paid orders whose slot ended NO_SHOW_GRACE_MS ago or more and expires them. */
export async function sweepNoShowOrders(now: Date = new Date()): Promise<number> {
  // Slot dates are IST calendar dates; a day of margin keeps the DB filter cheap and the exact check below.
  const candidates = await prisma.order.findMany({
    where: {
      paymentMethod: { in: NO_SHOW_METHODS },
      status: { in: NO_SHOW_ELIGIBLE },
      slot: { date: { lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) } },
    },
    orderBy: { slot: { date: 'asc' } },
    take: 1000, // oldest first; the next run continues any backlog
    select: { id: true, slot: { select: { date: true, endTime: true } } },
  });

  let expired = 0;
  for (const { id, slot } of candidates) {
    if (!slot) continue;
    if (now.getTime() - slotStartsAt(slot.date, slot.endTime).getTime() < NO_SHOW_GRACE_MS) continue;
    try {
      if (await markOrderNoShow(id)) expired++;
    } catch (err) {
      logger.error(`[Cron] Failed to mark order ${id} as no-show`, { error: err instanceof Error ? err.message : err });
    }
  }
  return expired;
}