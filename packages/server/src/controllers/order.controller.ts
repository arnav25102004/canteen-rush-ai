import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { placeOrder, cancelOrder } from '../services/order.service';
import { verifyQRToken, generateQRCodeDataURL } from '../services/qr.service';
import { z } from 'zod';
import { PaymentMethod, OrderStatus } from '@prisma/client';

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

export async function createOrder(req: AuthRequest, res: Response) {
  const parse = placeOrderSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  try {
    const order = await placeOrder({ userId: req.user!.id, ...parse.data }, req.io);
    return res.status(201).json({ order });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
}

export async function getMyOrders(req: AuthRequest, res: Response) {
  const { page = '1', limit = '20', status } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: {
        userId: req.user!.id,
        ...(status ? { status: status as OrderStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
      include: {
        canteen: { select: { id: true, name: true, imageUrl: true } },
        slot: { select: { startTime: true, endTime: true, date: true } },
        items: { include: { menuItem: { select: { name: true, imageUrl: true } } } },
      },
    }),
    prisma.order.count({ where: { userId: req.user!.id } }),
  ]);

  return res.json({ orders, total, page: parseInt(page as string), limit: parseInt(limit as string) });
}

export async function getOrder(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      canteen: { select: { id: true, name: true, imageUrl: true, location: true } },
      slot: true,
      items: {
        include: { menuItem: { select: { name: true, imageUrl: true, price: true } } },
      },
      rating: true,
    },
  });

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user!.id && req.user!.role !== 'VENDOR' && req.user!.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return res.json({ order });
}

export async function getOrderQR(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const order = await prisma.order.findUnique({ where: { id } });

  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  if (!order.qrCode) return res.status(400).json({ error: 'QR not available yet' });

  const qrDataUrl = await generateQRCodeDataURL(order.qrCode);
  return res.json({ qrCode: order.qrCode, qrDataUrl });
}

export async function studentCancelOrder(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { reason } = req.body;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });

  try {
    await cancelOrder(id, 'student', reason, req.io);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
}

// Vendor endpoints
export async function getVendorOrders(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const { date, slotId, status, page = '1', limit = '50' } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const targetDate = date ? new Date(date as string) : new Date();

  const orders = await prisma.order.findMany({
    where: {
      canteenId,
      ...(slotId ? { slotId: slotId as string } : {}),
      ...(status ? { status: status as OrderStatus } : { status: { notIn: ['CANCELLED'] } }),
      createdAt: {
        gte: new Date(targetDate.setHours(0, 0, 0, 0)),
        lte: new Date(targetDate.setHours(23, 59, 59, 999)),
      },
    },
    orderBy: { createdAt: 'asc' },
    skip,
    take: parseInt(limit as string),
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

  const validTransitions: Record<string, string[]> = {
    CONFIRMED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY'],
    READY: [],
  };

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const allowed = validTransitions[order.status] || [];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Cannot transition from ${order.status} to ${status}` });
  }

  const updates: any = { status };
  if (status === 'READY') updates.actualReadyAt = new Date();

  const updated = await prisma.order.update({ where: { id }, data: updates });

  if (req.io) {
    req.io.to(`order:${id}`).emit('order:status_update', {
      orderId: id, status, estimatedReadyAt: updated.estimatedReadyAt,
    });
    req.io.to(`canteen:${order.canteenId}`).emit('order:status_update', { orderId: id, status });
  }

  const { sendOrderNotification } = await import('../services/notification.service');
  await sendOrderNotification(order.userId, id, order.orderNumber, status as OrderStatus);

  return res.json({ order: updated });
}

export async function scanQR(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { qrToken } = req.body;

  if (!qrToken) return res.status(400).json({ error: 'qrToken required' });

  const canteenId = req.user!.canteenId;
  const payload = verifyQRToken(qrToken);

  if (!payload) return res.status(400).json({ error: 'Invalid or expired QR code' });
  if (payload.orderId !== id) return res.status(400).json({ error: 'QR code mismatch' });
  if (payload.canteenId !== canteenId) return res.status(400).json({ error: 'Wrong canteen' });

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'READY') return res.status(400).json({ error: 'Order is not ready yet' });
  if (order.qrScanned) return res.status(400).json({ error: 'Already collected' });

  const updated = await prisma.order.update({
    where: { id },
    data: { status: 'PICKED_UP', qrScanned: true, pickedUpAt: new Date() },
  });

  if (req.io) {
    req.io.to(`order:${id}`).emit('order:status_update', { orderId: id, status: 'PICKED_UP' });
  }

  return res.json({ success: true, order: updated });
}

export async function getPrepSheet(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const { date, slotId } = req.query;
  const targetDate = date ? new Date(date as string) : new Date();

  const whereSlot = slotId
    ? { slotId: slotId as string }
    : {
        slot: {
          date: { gte: new Date(targetDate.setHours(0, 0, 0, 0)), lte: new Date(targetDate.setHours(23, 59, 59, 999)) },
        },
      };

  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: { canteenId, status: { notIn: ['CANCELLED', 'PICKED_UP'] }, ...whereSlot },
    },
    include: {
      menuItem: { select: { name: true } },
      order: { include: { slot: { select: { startTime: true, endTime: true } } } },
    },
  });

  // Aggregate by item
  const aggregated: Record<string, { name: string; quantity: number; slots: Record<string, number> }> = {};
  for (const oi of orderItems) {
    const key = oi.menuItemId;
    const slotLabel = oi.order.slot
      ? `${oi.order.slot.startTime}-${oi.order.slot.endTime}`
      : 'Walk-in';
    if (!aggregated[key]) {
      aggregated[key] = { name: oi.menuItem.name, quantity: 0, slots: {} };
    }
    aggregated[key].quantity += oi.quantity;
    aggregated[key].slots[slotLabel] = (aggregated[key].slots[slotLabel] || 0) + oi.quantity;
  }

  return res.json({ prepSheet: Object.values(aggregated) });
}
