import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { validateBody } from '../utils/helpers';
import { Prisma } from '@prisma/client';
import { FEATURES } from '../config/features';
import { cached, sendCachedJson } from '../config/cache';
import { ACTIVE_ORDER_STATUSES, activeOrderCounts, CANTEEN_LIST_KEY, canteenKey, refreshCanteen } from '../services/catalogCache.service';
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
} satisfies Prisma.CanteenSelect;

function toPublicCanteen<T extends { id: string; razorpayAccountId: string | null }>(c: T, activeOrders: Map<string, number>) {
  const { razorpayAccountId, ...rest } = c;
  return {
    ...rest,
    _count: { orders: activeOrders.get(c.id) ?? 0 },
    onlinePaymentEnabled: FEATURES.RAZORPAY_ENABLED && !!razorpayAccountId,
  };
}

export async function listCanteens(req: Request, res: Response) {
  const { campus, includeInactive } = req.query;
  const load = async () => {
    const canteens = await prisma.canteen.findMany({
      where: {
        ...(includeInactive !== 'true' ? { isActive: true } : {}),
        ...(campus ? { campus: { contains: campus as string, mode: 'insensitive' } } : {}),
      },
      select: PUBLIC_CANTEEN_SELECT,
      orderBy: { name: 'asc' },
    });
    const activeOrders = await activeOrderCounts(canteens.map((c) => c.id));
    return { canteens: canteens.map((c) => toPublicCanteen(c, activeOrders)) };
  };
  // Only the default list is cached, so query strings can't create unlimited cache keys.
  if (campus || includeInactive === 'true') return res.json(await load());
  return sendCachedJson(req, res, await cached(CANTEEN_LIST_KEY, load, { ttl: 10, stale: 60 }), 'public, max-age=0, s-maxage=5, stale-while-revalidate=10');
}

export async function getCanteen(req: Request, res: Response) {
  const { id } = req.params;
  const body = await cached(canteenKey(id), async () => {
    const canteen = await prisma.canteen.findUnique({ where: { id }, select: PUBLIC_CANTEEN_SELECT });
    return canteen ? { canteen: toPublicCanteen(canteen, await activeOrderCounts([canteen.id])) } : null;
  }, { ttl: 10, stale: 60, cacheIf: (b) => !!b });
  if (!body) return res.status(404).json({ error: 'Canteen not found' });
  return sendCachedJson(req, res, body, 'public, max-age=0, s-maxage=5, stale-while-revalidate=10');
}

export async function getCanteenLiveStats(req: Request, res: Response) {
  const { id } = req.params;

  const stats = await cached(`canteen-live:${id}`, async () => {
    const [activeOrders, canteen] = await Promise.all([
      prisma.order.count({ where: { canteenId: id, status: { in: ACTIVE_ORDER_STATUSES } } }),
      prisma.canteen.findUnique({ where: { id }, select: { avgPrepTime: true } }),
    ]);
    return {
      exists: !!canteen,
      body: {
        canteenId: id,
        activeOrders,
        estimatedWaitMinutes: Math.ceil((activeOrders * (canteen?.avgPrepTime ?? 15)) / 3),
        queueCount: activeOrders,
      },
    };
  }, { ttl: 5, stale: 15, cacheIf: (s) => s.exists });
  return sendCachedJson(req, res, stats.body);
}

export async function createCanteen(req: AuthRequest, res: Response) {
  const v = validateBody(canteenSchema, req.body, res);
  if (!v.success) return;

  const canteen = await prisma.canteen.create({ data: v.data });
  await refreshCanteen(canteen.id);
  return res.status(201).json({ canteen });
}

export async function updateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const v = validateBody(canteenSchema.partial(), req.body, res);
  if (!v.success) return;

  const canteen = await prisma.canteen.update({ where: { id }, data: v.data });
  await refreshCanteen(id);
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
  await refreshCanteen(canteen.id);
  return res.json({ canteen: updated });
}

export async function deactivateCanteen(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.canteen.update({ where: { id }, data: { isActive: false } });
  await refreshCanteen(id);
  return res.json({ success: true });
}
