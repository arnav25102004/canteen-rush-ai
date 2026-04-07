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

