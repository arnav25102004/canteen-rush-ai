import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { z } from 'zod';

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
  vendorId: z.string().uuid().optional(),
});

export async function listCanteens(req: Request, res: Response) {
  const { campus } = req.query;
  const canteens = await prisma.canteen.findMany({
    where: {
      isActive: true,
      ...(campus ? { campus: { contains: campus as string, mode: 'insensitive' } } : {}),
    },
    include: {
      vendor: { select: { name: true, email: true } },
      _count: { select: { orders: { where: { status: { in: ['CONFIRMED', 'ACCEPTED', 'PREPARING'] } } } } },
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
      _count: { select: { orders: { where: { status: { in: ['CONFIRMED', 'ACCEPTED', 'PREPARING'] } } } } },
    },
  });
  if (!canteen) return res.status(404).json({ error: 'Canteen not found' });
  return res.json({ canteen });
}

export async function getCanteenLiveStats(req: Request, res: Response) {
  const { id } = req.params;
  const activeOrders = await prisma.order.count({
    where: { canteenId: id, status: { in: ['CONFIRMED', 'ACCEPTED', 'PREPARING'] } },
  });
  const canteen = await prisma.canteen.findUnique({
    where: { id },
    select: { avgPrepTime: true },
  });
  return res.json({
    canteenId: id,
    activeOrders,
    estimatedWaitMinutes: Math.ceil(activeOrders * (canteen?.avgPrepTime || 15) / 3),
    queueCount: activeOrders,
  });
}

export async function createCanteen(req: AuthRequest, res: Response) {
  const parse = canteenSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const canteen = await prisma.canteen.create({ data: parse.data });
  return res.status(201).json({ canteen });
}

export async function updateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const parse = canteenSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const canteen = await prisma.canteen.update({ where: { id }, data: parse.data });
  return res.json({ canteen });
}

export async function deactivateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.canteen.update({ where: { id }, data: { isActive: false } });
  return res.json({ success: true });
}
