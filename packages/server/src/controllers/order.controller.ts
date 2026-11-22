import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { placeOrder, cancelOrder, assertNotStrikeBanned, findRecentOrdersForUser } from '../services/order.service';
import { verifyQRToken, generateQRCodeDataURL } from '../services/qr.service';
import { enqueue } from '../services/outbox.service';
import { cached } from '../config/cache';
import { invalidateOrderViews, lastOrderKey, orderViewKey } from '../services/catalogCache.service';
import { parsePagination, buildDateRange, emitOrderUpdate, validateBody } from '../utils/helpers';
import { computeNudgeAt } from '../utils/feedbackNudge';
import { z } from 'zod';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';

const placeOrderSchema = z.object({
  canteenId: z.string().uuid(),
  slotId: z.string().uuid().optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive().max(50),
    customizations: z.record(z.string(), z.any()).optional(),
    notes: z.string().max(200).optional(),
  })).min(1).max(30),
  specialInstructions: z.string().max(500).optional(),
  pointsToRedeem: z.number().int().min(0).optional().default(0),
  clientRequestId: z.string().uuid().optional(),
});

// CANCELLED is not here: cancelling goes through cancelOrder() so the slot,
// wallet credit and points are released.
const VALID_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.CONFIRMED]: [OrderStatus.ACCEPTED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]: [],
};

export async function createOrder(req: AuthRequest, res: Response) {
  const v = validateBody(placeOrderSchema, req.body, res);
  if (!v.success) return;

  await assertNotStrikeBanned(req.user!.id);

  const result = await placeOrder({ userId: req.user!.id, userRole: req.user!.role, ...v.data }, req.io);
  return res.status(201).json({
    order: result.order,
    razorpay: result.razorpay,
    upiAmount: result.upiAmount,
    pointsDiscount: result.pointsDiscount,
    walletDeduction: result.walletDeduction,
    subtotal: result.subtotal,
  });
}

export async function getLastOrder(req: AuthRequest, res: Response) {
  const userId = req.user!.id;
  const body = await cached(lastOrderKey(userId), async () => {
    const [order = null] = await findRecentOrdersForUser(userId, 1);
    return { order };
  }, { ttl: 5, stale: 0, local: true });
  return res.setHeader('Cache-Control', 'private, no-store').json(body);
}

export async function getMyOrders(req: AuthRequest, res: Response) {
  const { page, limit, status } = req.query as Record<string, string>;
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);
  const userId = req.user!.id;

  const where = { userId, ...(status ? { status: status as OrderStatus } : {}) };
  const include = {
    canteen: { select: { id: true, name: true, imageUrl: true } },
    slot: { select: { startTime: true, endTime: true, date: true } },
    items: { include: { menuItem: { select: { name: true, imageUrl: true } } } },
  };

  // ?cursor= (empty for the first page) skips the COUNT and stays fast on long histories.
  if (typeof req.query.cursor === 'string') {
    const cursor = req.query.cursor;
    const rows = await prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: l + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include,
    });
    const orders = rows.slice(0, l);
    return res.json({ orders, nextCursor: rows.length > l ? orders.at(-1)!.id : null, limit: l });
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include,
    }),
    prisma.order.count({ where }),
  ]);

  return res.json({ orders, total, page: p, limit: l });
}

export async function getOrder(req: AuthRequest, res: Response) {
  const { id } = req.params;
  // The QR token is a pickup credential: it stays out of this cached view and comes only from /qr.
  const body = await cached(orderViewKey(id), async () => {
    const row = await prisma.order.findUnique({
      where: { id },
      include: {
        canteen: { select: { id: true, name: true, imageUrl: true, location: true, vendorUpiId: true, vendorUpiName: true } },
        slot: true,
        items: { include: { menuItem: { select: { name: true, imageUrl: true, price: true } } } },
        ratings: true,
      },
    });
    if (!row) return null;
    const { qrCode: _qrCode, ...order } = row;
    // `rating` (first rating) stays for older app versions for one release; new clients use `ratings`.
    return { order: { ...order, rating: order.ratings[0] ?? null } };
  }, { ttl: 3, stale: 0, local: true, cacheIf: (v) => !!v });

  if (!body) return res.status(404).json({ error: 'Order not found' });
  const { order } = body;
  const isOwner = order.userId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  const isThisCanteensVendor = req.user!.role === UserRole.VENDOR && order.canteen.id === req.user!.canteenId;
  if (!isOwner && !isAdmin && !isThisCanteensVendor) return res.status(403).json({ error: 'Forbidden' });

  return res.setHeader('Cache-Control', 'private, no-store').json(body);
}

export async function getOrderQR(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true, qrCode: true },
  });

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  if (!order.qrCode) return res.status(400).json({ error: 'QR not available yet' });

  const qrDataUrl = await generateQRCodeDataURL(order.qrCode);
  return res.json({ qrCode: order.qrCode, qrDataUrl });
}

export async function studentCancelOrder(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { reason } = req.body;

  const order = await prisma.order.findUnique({ where: { id }, select: { userId: true } });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  await cancelOrder(id, 'student', reason, req.io);
  return res.json({ success: true });
}

export async function getVendorOrders(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const { date, slotId, status, active } = req.query as Record<string, string>;
  const { skip, take } = parsePagination(req.query.page as string, req.query.limit as string || '50');
  const include = {
    user: { select: { name: true, phone: true } },
    slot: { select: { startTime: true, endTime: true } },
    items: { include: { menuItem: { select: { name: true } } } },
  };
  const orderBy = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

  if (active === 'true') {
    // Everything the kitchen still has to act on, whichever day it was placed. The statuses
    // are SQL literals because Postgres cannot match bound parameters to the partial index.
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM orders
      WHERE canteen_id = ${canteenId}
        AND status IN ('PENDING', 'CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY')
        ${slotId ? Prisma.sql`AND slot_id = ${slotId}` : Prisma.empty}
      ORDER BY created_at, id
      LIMIT ${take} OFFSET ${skip}`);
    const orders = await prisma.order.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy, include });
    return res.json({ orders });
  }

  const orders = await prisma.order.findMany({
    where: {
      canteenId,
      createdAt: buildDateRange(date),
      ...(slotId ? { slotId } : {}),
      ...(status ? { status: status as OrderStatus } : { status: { notIn: [OrderStatus.CANCELLED] } }),
    },
    orderBy,
    skip,
    take,
    include,
  });

  return res.json({ orders });
}

export async function updateOrderStatus(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { status } = req.body;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { status: true, canteenId: true, userId: true, orderNumber: true, estimatedReadyAt: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.canteenId !== req.user!.canteenId) return res.status(403).json({ error: 'Forbidden' });

  if (status === OrderStatus.CANCELLED) {
    await cancelOrder(id, 'vendor', req.body.reason || 'Cancelled by vendor', req.io);
    return res.json({ success: true });
  }

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Cannot transition from ${order.status} to ${status}` });
  }

  // Conditional on the status we validated against, so two clicks can't race.
  const changed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id, status: order.status },
      data: { status, ...(status === OrderStatus.READY ? { actualReadyAt: new Date() } : {}) },
    });
    if (count === 0) return false;
    if (order.userId) {
      await enqueue(tx, {
        type: 'notification.order',
        payload: { userId: order.userId, orderId: id, orderNumber: order.orderNumber, status: status as OrderStatus },
      });
    }
    return true;
  });
  if (!changed) return res.status(409).json({ error: 'Order changed, refresh and try again' });
  await invalidateOrderViews(id, order.userId);
  const updated = await prisma.order.findUniqueOrThrow({ where: { id } });

  emitOrderUpdate(req.io, id, order.canteenId, { status, estimatedReadyAt: updated.estimatedReadyAt });

  return res.json({ order: updated });
}

export async function scanQR(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { qrToken } = req.body;

  if (!qrToken) return res.status(400).json({ error: 'qrToken required' });

  const payload = verifyQRToken(qrToken);
  if (!payload) return res.status(400).json({ error: 'Invalid or expired QR code' });
  if (payload.orderId !== id) return res.status(400).json({ error: 'QR code mismatch' });
  if (payload.canteenId !== req.user!.canteenId) return res.status(400).json({ error: 'Wrong canteen' });

  const order = await prisma.order.findUnique({
    where: { id },
    select: { status: true, qrScanned: true, canteenId: true, paymentMethod: true, userId: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== OrderStatus.READY) return res.status(400).json({ error: 'Order is not ready yet' });
  if (order.qrScanned) return res.status(400).json({ error: 'Already collected' });

  // Atomic hand-over: a QR can only be redeemed once even if scanned twice at once.
  // Cash orders are paid at this moment, at the counter.
  const pickedUpAt = new Date();
  const collected = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id, status: OrderStatus.READY, qrScanned: false },
      data: {
        status: OrderStatus.PICKED_UP,
        qrScanned: true,
        pickedUpAt,
        feedbackNudgeAt: computeNudgeAt(pickedUpAt),
        ...(order.paymentMethod === 'CASH' ? { paymentStatus: 'PAID' as const, paymentVerifiedAt: new Date() } : {}),
      },
    });
    if (count === 0) return false;
    await enqueue(tx, { type: 'loyalty.award', payload: { orderId: id } });
    return true;
  });
  if (!collected) return res.status(400).json({ error: 'Already collected' });
  await invalidateOrderViews(id, order.userId);
  const updated = await prisma.order.findUniqueOrThrow({ where: { id } });

  emitOrderUpdate(req.io, id, order.canteenId, { status: OrderStatus.PICKED_UP });

  return res.json({ success: true, order: updated });
}

export async function respondToOrder(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { action, rejectReason } = req.body as { action: 'ACCEPT' | 'REJECT'; rejectReason?: string };

  if (!['ACCEPT', 'REJECT'].includes(action)) {
    return res.status(400).json({ error: 'action must be ACCEPT or REJECT' });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { status: true, canteenId: true, userId: true, orderNumber: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.canteenId !== req.user!.canteenId) return res.status(403).json({ error: 'Forbidden' });
  if (order.status !== OrderStatus.CONFIRMED) {
    return res.status(400).json({ error: 'Can only respond to CONFIRMED orders' });
  }

  if (action === 'ACCEPT') {
    const accepted = await prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: OrderStatus.CONFIRMED },
        data: { status: OrderStatus.ACCEPTED },
      });
      if (count === 0) return false;
      if (order.userId) {
        await enqueue(tx, {
          type: 'notification.order',
          payload: { userId: order.userId, orderId: id, orderNumber: order.orderNumber, status: OrderStatus.ACCEPTED },
        });
      }
      return true;
    });
    if (!accepted) return res.status(409).json({ error: 'Order changed, refresh and try again' });
    await invalidateOrderViews(id, order.userId);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id } });
    emitOrderUpdate(req.io, id, order.canteenId, { status: OrderStatus.ACCEPTED });
    return res.json({ order: updated });
  }

  await cancelOrder(id, 'vendor', rejectReason || 'Rejected by vendor', req.io);
  return res.json({ success: true });
}

export async function getPrepSheet(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const { date, slotId } = req.query as Record<string, string>;
  const { gte, lte } = buildDateRange(date);

  // One aggregate over open orders only. Unpaid and uncollected orders are not food to make.
  const rows = await prisma.$queryRaw<Array<{ menuItemId: string; name: string; startTime: string | null; endTime: string | null; quantity: number }>>(Prisma.sql`
    SELECT oi.menu_item_id AS "menuItemId", mi.name, ps.start_time AS "startTime", ps.end_time AS "endTime",
           SUM(oi.quantity)::int AS quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    LEFT JOIN pickup_slots ps ON ps.id = o.slot_id
    WHERE o.canteen_id = ${canteenId}
      AND o.status IN ('CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY')
      AND ${slotId ? Prisma.sql`o.slot_id = ${slotId}` : Prisma.sql`o.created_at >= ${gte} AND o.created_at <= ${lte}`}
    GROUP BY 1, 2, 3, 4`);

  const aggregated: Record<string, { name: string; quantity: number; slots: Record<string, number> }> = {};
  for (const row of rows) {
    const slotLabel = row.startTime ? `${row.startTime}-${row.endTime}` : 'Walk-in';
    aggregated[row.menuItemId] ??= { name: row.name, quantity: 0, slots: {} };
    aggregated[row.menuItemId].quantity += row.quantity;
    aggregated[row.menuItemId].slots[slotLabel] = (aggregated[row.menuItemId].slots[slotLabel] || 0) + row.quantity;
  }

  return res.json({ prepSheet: Object.values(aggregated) });
}
