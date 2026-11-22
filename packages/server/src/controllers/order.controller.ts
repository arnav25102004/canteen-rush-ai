import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { placeOrder, cancelOrder, assertNotStrikeBanned, findRecentOrdersForUser } from '../services/order.service';
import { verifyQRToken, generateQRCodeDataURL } from '../services/qr.service';
import { enqueue } from '../services/outbox.service';
import { parsePagination, buildDateRange, emitOrderUpdate, validateBody } from '../utils/helpers';
import { computeNudgeAt } from '../utils/feedbackNudge';
import { z } from 'zod';
import { OrderStatus, UserRole } from '@prisma/client';

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

// Everything the kitchen board still has to act on, whichever day it was placed.
const KITCHEN_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY,
];

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
  const [order = null] = await findRecentOrdersForUser(req.user!.id, 1);
  return res.json({ order });
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
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      canteen: { select: { id: true, name: true, imageUrl: true, location: true, vendorUpiId: true, vendorUpiName: true } },
      slot: true,
      items: { include: { menuItem: { select: { name: true, imageUrl: true, price: true } } } },
      ratings: true,
    },
  });

  if (!order) return res.status(404).json({ error: 'Order not found' });
  const isOwner = order.userId === req.user!.id;
  const isAdmin = req.user!.role === UserRole.ADMIN;
  const isThisCanteensVendor = req.user!.role === UserRole.VENDOR && order.canteen.id === req.user!.canteenId;
  if (!isOwner && !isAdmin && !isThisCanteensVendor) return res.status(403).json({ error: 'Forbidden' });

  // `rating` (first rating) stays for older app versions for one release; new clients use `ratings`.
  return res.json({ order: { ...order, rating: order.ratings[0] ?? null } });
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

  const orders = await prisma.order.findMany({
    where: {
      canteenId,
      ...(slotId ? { slotId } : {}),
      ...(active === 'true'
        ? { status: { in: KITCHEN_STATUSES } }
        : {
            createdAt: buildDateRange(date),
            ...(status ? { status: status as OrderStatus } : { status: { notIn: [OrderStatus.CANCELLED] } }),
          }),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    skip,
    take,
    include: {
      user: { select: { name: true, phone: true } },
      slot: { select: { startTime: true, endTime: true } },
      items: { include: { menuItem: { select: { name: true } } } },
    },
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
    select: { status: true, qrScanned: true, canteenId: true, paymentMethod: true },
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
  const createdAt = buildDateRange(date);

  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        canteenId,
        // Unpaid and uncollected orders are not food the kitchen has to make.
        status: { notIn: [OrderStatus.PENDING, OrderStatus.CANCELLED, OrderStatus.NO_SHOW, OrderStatus.PICKED_UP] },
        ...(slotId ? { slotId } : { createdAt }),
      },
    },
    include: {
      menuItem: { select: { name: true } },
      order: { include: { slot: { select: { startTime: true, endTime: true } } } },
    },
  });

  const aggregated: Record<string, { name: string; quantity: number; slots: Record<string, number> }> = {};
  for (const oi of orderItems) {
    const key = oi.menuItemId;
    const slotLabel = oi.order.slot ? `${oi.order.slot.startTime}-${oi.order.slot.endTime}` : 'Walk-in';
    if (!aggregated[key]) aggregated[key] = { name: oi.menuItem.name, quantity: 0, slots: {} };
    aggregated[key].quantity += oi.quantity;
    aggregated[key].slots[slotLabel] = (aggregated[key].slots[slotLabel] || 0) + oi.quantity;
  }

  return res.json({ prepSheet: Object.values(aggregated) });
}
