import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { validateBody } from '../utils/helpers';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';

const ACTIVE_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.ACCEPTED, OrderStatus.PREPARING];

const canteenSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  campus: z.string(),
  location: z.string().optional(),
  imageUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  openingTime: z.string().regex(/^\d{2}:\d{2}$/),
  closingTime: z.string().regex(/^\d{2}:\d{2}$/),
  contactPhone: z.string().optional(),
  avgPrepTime: z.number().int().positive().optional(),
  institutionId: z.string(),
  isActive: z.boolean().optional(),
});

export async function listCanteens(req: Request, res: Response) {
  const { campus, includeInactive } = req.query;
  const canteens = await prisma.canteen.findMany({
    where: {
      ...(includeInactive !== 'true' ? { isActive: true } : {}),
      ...(campus ? { campus: { contains: campus as string, mode: 'insensitive' } } : {}),
    },
    include: {
      vendor: { select: { name: true, email: true } },
      _count: { select: { orders: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
    orderBy: { name: 'asc' },
  });
  return res.json({ canteens });
}

export async function getCanteen(req: Request, res: Response) {
  const { id } = req.params;
  const canteen = await prisma.canteen.findUnique({
    where: { id },
    include: {
      vendor: { select: { name: true, email: true } },
      _count: { select: { orders: { where: { status: { in: ACTIVE_STATUSES } } } } },
    },
  });
  if (!canteen) return res.status(404).json({ error: 'Canteen not found' });
  return res.json({ canteen });
}

export async function getCanteenLiveStats(req: Request, res: Response) {
  const { id } = req.params;

  const [activeOrders, canteen] = await Promise.all([
    prisma.order.count({ where: { canteenId: id, status: { in: ACTIVE_STATUSES } } }),
    prisma.canteen.findUnique({ where: { id }, select: { avgPrepTime: true } }),
  ]);

  return res.json({
    canteenId: id,
    activeOrders,
    estimatedWaitMinutes: Math.ceil((activeOrders * (canteen?.avgPrepTime ?? 15)) / 3),
    queueCount: activeOrders,
  });
}

export async function createCanteen(req: AuthRequest, res: Response) {
  const v = validateBody(canteenSchema, req.body, res);
  if (!v.success) return;

  const canteen = await prisma.canteen.create({ data: v.data });
  return res.status(201).json({ canteen });
}

export async function updateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const v = validateBody(canteenSchema.partial(), req.body, res);
  if (!v.success) return;

  const canteen = await prisma.canteen.update({ where: { id }, data: v.data });
  return res.json({ canteen });
}

export async function deactivateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.canteen.update({ where: { id }, data: { isActive: false } });
  return res.json({ success: true });
}
