import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { validateBody } from '../utils/helpers';
import { OrderStatus, Prisma } from '@prisma/client';
import { FEATURES } from '../config/features';
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
  vendorUpiId: z.string().optional(),
  vendorUpiName: z.string().optional(),
});

// Public fields only: no razorpayAccountId / vendorUpiId / vendorUpiName.
// vendorId is kept because the web admin "vendors" page maps vendor -> canteen with it.
const PUBLIC_CANTEEN_SELECT = {
  id: true, name: true, description: true, campus: true, location: true,
  imageUrl: true, bannerUrl: true, isActive: true, openingTime: true, closingTime: true,
  contactPhone: true, avgPrepTime: true, institutionId: true, vendorId: true,
  createdAt: true, updatedAt: true,
  razorpayAccountId: true, // only used to derive onlinePaymentEnabled; stripped by toPublicCanteen
  vendor: { select: { name: true } },
  _count: { select: { orders: { where: { status: { in: ACTIVE_STATUSES } } } } },
} satisfies Prisma.CanteenSelect;

function toPublicCanteen<T extends { razorpayAccountId: string | null }>(c: T) {
  const { razorpayAccountId, ...rest } = c;
  return { ...rest, onlinePaymentEnabled: FEATURES.RAZORPAY_ENABLED && !!razorpayAccountId };
}

export async function listCanteens(req: Request, res: Response) {
  const { campus, includeInactive } = req.query;
  const canteens = await prisma.canteen.findMany({
    where: {
      ...(includeInactive !== 'true' ? { isActive: true } : {}),
      ...(campus ? { campus: { contains: campus as string, mode: 'insensitive' } } : {}),
    },
    select: PUBLIC_CANTEEN_SELECT,
    orderBy: { name: 'asc' },
  });
  return res.json({ canteens: canteens.map(toPublicCanteen) });
}

export async function getCanteen(req: Request, res: Response) {
  const { id } = req.params;
  const canteen = await prisma.canteen.findUnique({
    where: { id },
    select: PUBLIC_CANTEEN_SELECT,
  });
  if (!canteen) return res.status(404).json({ error: 'Canteen not found' });
  return res.json({ canteen: toPublicCanteen(canteen) });
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

// Fields a vendor may change on their own canteen. Everything else
// (institution, Razorpay account) is admin-only.
const myCanteenSchema = canteenSchema
  .pick({
    name: true, description: true, location: true, imageUrl: true, bannerUrl: true,
    openingTime: true, closingTime: true, contactPhone: true, avgPrepTime: true,
    vendorUpiId: true, vendorUpiName: true, isActive: true,
  })
  .partial();

export async function getMyCanteen(req: AuthRequest, res: Response) {
  const canteen = await prisma.canteen.findFirst({ where: { vendorId: req.user!.id } });
  if (!canteen) return res.status(404).json({ error: 'No canteen assigned to this vendor' });
  return res.json({ canteen });
}

export async function updateMyCanteen(req: AuthRequest, res: Response) {
  const canteen = await prisma.canteen.findFirst({ where: { vendorId: req.user!.id } });
  if (!canteen) return res.status(404).json({ error: 'No canteen assigned to this vendor' });

  const v = validateBody(myCanteenSchema, req.body, res);
  if (!v.success) return;

  const updated = await prisma.canteen.update({ where: { id: canteen.id }, data: v.data });
  return res.json({ canteen: updated });
}

export async function deactivateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.canteen.update({ where: { id }, data: { isActive: false } });
  return res.json({ success: true });
}
