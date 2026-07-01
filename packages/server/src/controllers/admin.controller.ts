import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

const announcementSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  canteenId: z.string().uuid().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
});

export async function listVendors(req: AuthRequest, res: Response) {
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

  const canteen = await prisma.canteen.update({
    where: { id: canteenId },
    data: { vendorId },
  });
  return res.json({ canteen });
}

export async function createAnnouncement(req: AuthRequest, res: Response) {
  const parse = announcementSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

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

export async function listAnnouncements(req: AuthRequest, res: Response) {
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
  return res.json({ announcements });
}

// ─── Settlements ──────────────────────────────────────────────────────────────

export async function getSettlements(req: AuthRequest, res: Response) {
  const { date, canteenId } = req.query as Record<string, string>;

  // If date provided, compute settlements for that date on the fly if not yet created
  if (date) {
    const target = new Date(date);
    const nextDay = new Date(target);
    nextDay.setDate(nextDay.getDate() + 1);

    const where = {
      status: { notIn: ['CANCELLED' as any] },
      paymentStatus: 'PAID' as any,
      createdAt: { gte: target, lt: nextDay },
      ...(canteenId ? { canteenId } : {}),
    };

    const orders = await prisma.order.findMany({
      where,
      select: { canteenId: true, totalAmount: true },
    });

    const byCanteen: Record<string, { totalOrders: number; grossAmount: number }> = {};
    for (const o of orders) {
      if (!byCanteen[o.canteenId]) byCanteen[o.canteenId] = { totalOrders: 0, grossAmount: 0 };
      byCanteen[o.canteenId].totalOrders += 1;
      byCanteen[o.canteenId].grossAmount += Number(o.totalAmount);
    }

    const canteens = await prisma.canteen.findMany({
      where: canteenId ? { id: canteenId } : {},
      select: { id: true, name: true },
    });

    const settlements = canteens.map((c) => {
      const stats = byCanteen[c.id] || { totalOrders: 0, grossAmount: 0 };
      const platformFee = Math.round(stats.grossAmount * 0.02 * 100) / 100;
      const netAmount = Math.round((stats.grossAmount - platformFee) * 100) / 100;
      return { canteenId: c.id, canteenName: c.name, date, totalOrders: stats.totalOrders, grossAmount: stats.grossAmount, platformFee, netAmount };
    });

    // Upsert into DB
    for (const s of settlements) {
      if (s.totalOrders > 0) {
        await prisma.dailySettlement.upsert({
          where: { canteenId_date: { canteenId: s.canteenId, date: target } },
          update: { totalOrders: s.totalOrders, grossAmount: s.grossAmount, platformFee: s.platformFee, netAmount: s.netAmount },
          create: { canteenId: s.canteenId, date: target, totalOrders: s.totalOrders, grossAmount: s.grossAmount, platformFee: s.platformFee, netAmount: s.netAmount },
        });
      }
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
  const { role, page = '1', limit = '50' } = req.query as Record<string, string>;
  const skip = (Number(page) - 1) * Number(limit);

  const where = role ? { role: role as UserRole } : {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, department: true, campus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    }),
    prisma.user.count({ where }),
  ]);
  return res.json({ users, total });
}

export async function updateUserRole(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const parse = z.object({ role: z.nativeEnum(UserRole) }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  if (id === req.user!.id) return res.status(400).json({ error: 'Cannot change your own role' });

  const user = await prisma.user.update({
    where: { id },
    data: { role: parse.data.role },
    select: { id: true, name: true, email: true, role: true },
  });
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
  return res.json({ success: true, user });
}

