import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { parsePagination } from '../utils/helpers';

export async function getNotifications(req: AuthRequest, res: Response) {
  const { page, limit } = req.query as Record<string, string>;
  const { skip, take, page: p, limit: l } = parsePagination(page, limit);

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.notification.count({ where: { userId: req.user!.id } }),
  ]);

  return res.json({ notifications, total, page: p, limit: l });
}

export async function markRead(req: AuthRequest, res: Response) {
  const { id } = req.params;
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  return res.json({ success: true });
}

export async function markAllRead(req: AuthRequest, res: Response) {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, isRead: false },
    data: { isRead: true },
  });
  return res.json({ success: true });
}

export async function getAnnouncements(req: AuthRequest, res: Response) {
  const now = new Date();
  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: { startsAt: 'desc' },
  });
  return res.json({ announcements });
}
