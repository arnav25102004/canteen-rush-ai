import { invalidateAuthUserById } from '../services/authUser.service';
import { refreshCanteen } from '../services/catalogCache.service';
import { disconnectUser } from '../socket/orderSocket';
import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { buildDateRange, parsePagination } from '../utils/helpers';

const announcementSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  canteenId: z.string().uuid().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
});

export async function listVendors(_req: AuthRequest, res: Response) {
  const vendors = await prisma.user.findMany({
    where: { role: UserRole.VENDOR },
    select: {
      id: true, name: true, email: true, phone: true, createdAt: true,
      vendorCanteen: { select: { id: true, name: true } },
    },
  });
  return res.json({ vendors });
}

export async function assignVendorToCanteen(req: AuthRequest, res: Response) {
  const { vendorId, canteenId } = req.body;
  if (!vendorId || !canteenId) return res.status(400).json({ error: 'vendorId and canteenId required' });

  const vendor = await prisma.user.findUnique({ where: { id: vendorId }, select: { role: true } });
  if (vendor?.role !== UserRole.VENDOR) return res.status(400).json({ error: 'User is not a vendor' });

  const target = await prisma.canteen.findUnique({ where: { id: canteenId }, select: { id: true, vendorId: true } });
  if (!target) return res.status(404).json({ error: 'Canteen not found' });

  // A vendor runs one canteen (vendorId is unique), so move them off any other
  // canteen first. If the target canteen already has a vendor, they are replaced.
  const canteen = await prisma.$transaction(async (tx) => {
    await tx.canteen.updateMany({ where: { vendorId, id: { not: canteenId } }, data: { vendorId: null } });
    return tx.canteen.update({ where: { id: canteenId }, data: { vendorId } });
  });
  await invalidateAuthUserById(vendorId, target.vendorId);
  await refreshCanteen(canteenId);
  return res.json({ canteen });
}

export async function unassignVendor(req: AuthRequest, res: Response) {
  const { vendorId, canteenId } = req.body as { vendorId?: string; canteenId?: string };
  if (!vendorId && !canteenId) return res.status(400).json({ error: 'vendorId or canteenId required' });

  const where = vendorId ? { vendorId } : { id: canteenId };
  const affected = await prisma.canteen.findMany({ where, select: { id: true, vendorId: true } });
  const result = await prisma.canteen.updateMany({ where, data: { vendorId: null } });
  await invalidateAuthUserById(...affected.map((c) => c.vendorId));
  await Promise.all(affected.map((c) => refreshCanteen(c.id)));
  return res.json({ unassigned: result.count });
}

export async function createAnnouncement(req: AuthRequest, res: Response) {
  const parse = announcementSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: z.flattenError(parse.error) });

  const announcement = await prisma.announcement.create({ data: parse.data as any });
  return res.json({ announcement });
}

export async function toggleAnnouncement(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const ann = await prisma.announcement.findUnique({ where: { id }, select: { isActive: true } });
  if (!ann) return res.status(404).json({ error: 'Announcement not found' });

  const updated = await prisma.announcement.update({ where: { id }, data: { isActive: !ann.isActive } });
  return res.json({ announcement: updated });
}

export async function listAnnouncements(_req: AuthRequest, res: Response) {
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
  return res.json({ announcements });
}

// ─── Settlements ──────────────────────────────────────────────────────────────

export async function getSettlements(req: AuthRequest, res: Response) {
  const { date, canteenId } = req.query as Record<string, string>;

  // If date provided, compute that IST day's settlements. Rows already paid are a record and never change.
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const target = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(target.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const scope = canteenId ? { canteenId } : {};

    const [totals, canteens, existing] = await Promise.all([
      prisma.order.groupBy({
        by: ['canteenId'],
        where: { status: { not: OrderStatus.CANCELLED }, paymentStatus: 'PAID', createdAt: buildDateRange(date), ...scope },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.canteen.findMany({ where: canteenId ? { id: canteenId } : {}, select: { id: true, name: true } }),
      prisma.dailySettlement.findMany({ where: { date: target, ...scope } }),
    ]);
    const totalsBy = new Map(totals.map((t) => [t.canteenId, t]));
    const existingBy = new Map(existing.map((s) => [s.canteenId, s]));

    const settlements = [];
    for (const c of canteens) {
      const stats = totalsBy.get(c.id);
      const totalOrders = stats?._count._all ?? 0;
      const gross = stats?._sum.totalAmount ?? new Prisma.Decimal(0);
      const fee = gross.mul('0.02').toDecimalPlaces(2);
      const net = gross.minus(fee);
      const amounts = { totalOrders, grossAmount: gross, platformFee: fee, netAmount: net };

      let row = existingBy.get(c.id) ?? null;
      if (!row?.isPaid && (row || totalOrders > 0)) {
        row = await prisma.dailySettlement.upsert({
          where: { canteenId_date: { canteenId: c.id, date: target } },
          update: amounts,
          create: { canteenId: c.id, date: target, ...amounts },
        });
      }
      settlements.push({
        id: row?.id,
        canteenId: c.id,
        canteenName: c.name,
        date,
        totalOrders: row?.totalOrders ?? 0,
        grossAmount: Number(row?.grossAmount ?? 0),
        platformFee: Number(row?.platformFee ?? 0),
        netAmount: Number(row?.netAmount ?? 0),
        isPaid: row?.isPaid ?? false,
        paidAt: row?.paidAt ?? null,
      });
    }
    return res.json({ settlements });
  }

  // No date: return stored settlements
  const stored = await prisma.dailySettlement.findMany({
    where: canteenId ? { canteenId } : {},
    orderBy: { date: 'desc' },
    include: { canteen: { select: { name: true } } },
    take: 90,
  });
  return res.json({ settlements: stored });
}

export async function markSettlementPaid(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const settlement = await prisma.dailySettlement.findUnique({ where: { id } });
  if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
  if (settlement.isPaid) return res.status(400).json({ error: 'Already marked as paid' });

  const updated = await prisma.dailySettlement.update({
    where: { id },
    data: { isPaid: true, paidAt: new Date(), paidBy: req.user!.id },
  });
  return res.json({ settlement: updated });
}

// ─── User management ──────────────────────────────────────────────────────────

export async function listUsers(req: AuthRequest, res: Response) {
  const { role, page, limit, q } = req.query as Record<string, string>;
  const { skip, take } = parsePagination(page, limit || '50');
  const search = typeof q === 'string' ? q.trim().slice(0, 100) : '';

  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    ...(role ? { role: role as UserRole } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, department: true, campus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);
  return res.json({ users, total });
}

export async function updateUserRole(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const parse = z.object({ role: z.enum(UserRole) }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: z.flattenError(parse.error) });

  if (id === req.user!.id) return res.status(400).json({ error: 'Cannot change your own role' });

  // SUPER_ADMIN sees every institution, so an institution ADMIN can neither grant nor remove it.
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (parse.data.role === UserRole.SUPER_ADMIN || target.role === UserRole.SUPER_ADMIN) {
    return res.status(403).json({ error: 'SUPER_ADMIN cannot be changed here' });
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role: parse.data.role },
    select: { id: true, name: true, email: true, role: true },
  });
  await invalidateAuthUserById(id);
  disconnectUser(req.io, id);
  return res.json({ user });
}

export async function banUser(req: AuthRequest, res: Response) {
  const { userId, reason } = req.body as { userId: string; reason?: string };
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (userId === req.user!.id) return res.status(400).json({ error: 'Cannot ban yourself' });

  const user = await prisma.user.update({
    where: { id: userId },
    data: { isBanned: true, banReason: reason || null, bannedAt: new Date() },
    select: { id: true, name: true, email: true, isBanned: true, banReason: true },
  });
  await invalidateAuthUserById(userId);
  disconnectUser(req.io, userId);
  return res.json({ success: true, user });
}

export async function unbanUser(req: AuthRequest, res: Response) {
  const { userId } = req.body as { userId: string };
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const user = await prisma.user.update({
    where: { id: userId },
    data: { isBanned: false, banReason: null, bannedAt: null },
    select: { id: true, name: true, email: true, isBanned: true },
  });
  await invalidateAuthUserById(userId);
  return res.json({ success: true, user });
}

