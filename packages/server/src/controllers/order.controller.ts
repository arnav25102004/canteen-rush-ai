import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { placeOrder, cancelOrder } from '../services/order.service';
import { verifyQRToken, generateQRCodeDataURL } from '../services/qr.service';
import { sendOrderNotification } from '../services/notification.service';
import { parsePagination, buildDateRange, emitOrderUpdate, validateBody } from '../utils/helpers';
import { z } from 'zod';
import { PaymentMethod, OrderStatus, UserRole } from '@prisma/client';

const ACTIVE_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.ACCEPTED, OrderStatus.PREPARING];

const placeOrderSchema = z.object({
  canteenId: z.string().uuid(),
  slotId: z.string().uuid().optional(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    customizations: z.record(z.any()).optional(),
    notes: z.string().optional(),
  })).min(1),
  paymentMethod: z.nativeEnum(PaymentMethod),
  specialInstructions: z.string().optional(),
});

const VALID_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.CONFIRMED]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY],
  [OrderStatus.READY]: [],
};

export async function createOrder(req: AuthRequest, res: Response) {
  const v = validateBody(placeOrderSchema, req.body, res);
  if (!v.success) return;

  try {
    const order = await placeOrder({ userId: req.user!.id, ...v.data }, req.io);
    return res.status(201).json({ order });
  } catch (err: unknown) {
    return res.status(400).json({ error: (err as Error).message });
  }
}

export async function getMyOrders(req: AuthRequest, res: Response) {
  const { page, limit, status } = req.query as Record<string, string>;
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);
  const userId = req.user!.id;

  const where = { userId, ...(status ? { status: status as OrderStatus } : {}) };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        canteen: { select: { id: true, name: true, imageUrl: true } },
        slot: { select: { startTime: true, endTime: true, date: true } },
        items: { include: { menuItem: { select: { name: true, imageUrl: true } } } },
      },
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
      canteen: { select: { id: true, name: true, imageUrl: true, location: true } },
      slot: true,
      items: { include: { menuItem: { select: { name: true, imageUrl: true, price: true } } } },
      rating: true,
    },
  });

  if (!order) return res.status(404).json({ error: 'Order not found' });
  const isOwner = order.userId === req.user!.id;
  const isStaff = req.user!.role === UserRole.VENDOR || req.user!.role === UserRole.ADMIN;
  if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

  return res.json({ order });
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

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  try {
    await cancelOrder(id, 'student', reason, req.io);
    return res.json({ success: true });
  } catch (err: unknown) {
    return res.status(400).json({ error: (err as Error).message });
  }
}

export async function getVendorOrders(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const { date, slotId, status } = req.query as Record<string, string>;
  const { skip, take } = parsePagination(req.query.page as string, req.query.limit as string || '50');
  const createdAt = buildDateRange(date);

  const orders = await prisma.order.findMany({
    where: {
      canteenId,
      createdAt,
      ...(slotId ? { slotId } : {}),
      ...(status ? { status: status as OrderStatus } : { status: { notIn: [OrderStatus.CANCELLED] } }),
    },
    orderBy: { createdAt: 'asc' },
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

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Cannot transition from ${order.status} to ${status}` });
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status,
      ...(status === OrderStatus.READY ? { actualReadyAt: new Date() } : {}),
    },
  });

  emitOrderUpdate(req.io, id, order.canteenId, { status, estimatedReadyAt: updated.estimatedReadyAt });
  await sendOrderNotification(order.userId, id, order.orderNumber, status as OrderStatus);

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
    select: { status: true, qrScanned: true, canteenId: true },
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== OrderStatus.READY) return res.status(400).json({ error: 'Order is not ready yet' });
  if (order.qrScanned) return res.status(400).json({ error: 'Already collected' });

  const updated = await prisma.order.update({
    where: { id },
    data: { status: OrderStatus.PICKED_UP, qrScanned: true, pickedUpAt: new Date() },
  });

  emitOrderUpdate(req.io, id, order.canteenId, { status: OrderStatus.PICKED_UP });

  return res.json({ success: true, order: updated });
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
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.PICKED_UP] },
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
    const slotLabel = oi.order.slot
      ? `${oi.order.slot.startTime}-${oi.order.slot.endTime}`
      : 'Walk-in';
    if (!aggregated[key]) aggregated[key] = { name: oi.menuItem.name, quantity: 0, slots: {} };
    aggregated[key].quantity += oi.quantity;
    aggregated[key].slots[slotLabel] = (aggregated[key].slots[slotLabel] || 0) + oi.quantity;
  }

  return res.json({ prepSheet: Object.values(aggregated) });
}
