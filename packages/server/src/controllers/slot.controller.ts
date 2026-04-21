import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getSlotAvailability, generateSlotsForCanteen } from '../services/slot.service';
import { parseTimeString, validateBody } from '../utils/helpers';
import { z } from 'zod';

const generateSlotsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  slots: z.array(z.object({
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    maxOrders: z.number().int().positive(),
    walkInReserved: z.number().int().optional(),
  })),
});

const updateSlotSchema = z.object({
  maxOrders: z.number().int().positive().optional(),
  walkInReserved: z.number().int().optional(),
});

export async function listSlotsForCanteen(req: AuthRequest, res: Response) {
  const { id: canteenId } = req.params;
  const { date } = req.query;
  const userRole = req.user?.role;

  const targetDate = date ? new Date(date as string) : new Date();
  targetDate.setUTCHours(0, 0, 0, 0);

  const now = new Date();
  const cutoffMs = 10 * 60 * 1000;

  const slots = await prisma.pickupSlot.findMany({
    where: { canteenId, date: targetDate },
    orderBy: { startTime: 'asc' },
  });

  // Fetch all availabilities in parallel, passing user role for faculty priority
  const availabilities = await Promise.all(slots.map((s) => getSlotAvailability(s.id, userRole)));

  const enriched = slots.map((slot, i) => {
    const { hours, minutes } = parseTimeString(slot.startTime);
    const slotDateTime = new Date(targetDate);
    slotDateTime.setHours(hours, minutes, 0, 0);
    return { ...availabilities[i], isCutoffPassed: slotDateTime.getTime() - now.getTime() < cutoffMs };
  });

  return res.json({ slots: enriched, date: targetDate.toISOString().split('T')[0] });
}

export async function generateSlots(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const v = validateBody(generateSlotsSchema, req.body, res);
  if (!v.success) return;

  const { startDate, endDate, slots } = v.data;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const created: Awaited<ReturnType<typeof generateSlotsForCanteen>> = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const daySlots = await generateSlotsForCanteen(canteenId, new Date(d), slots);
    created.push(...daySlots);
  }

  return res.json({ created: created.length, slots: created });
}

export async function updateSlot(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const v = validateBody(updateSlotSchema, req.body, res);
  if (!v.success) return;

  const slot = await prisma.pickupSlot.update({ where: { id }, data: v.data });
  return res.json({ slot });
}

export async function toggleSlot(req: AuthRequest, res: Response) {
  const { id } = req.params;
  // Use updateMany to avoid fetch-before-update; if no rows updated → not found
  const slot = await prisma.pickupSlot.findUnique({ where: { id }, select: { isOpen: true } });
  if (!slot) return res.status(404).json({ error: 'Slot not found' });

  const updated = await prisma.pickupSlot.update({ where: { id }, data: { isOpen: !slot.isOpen } });
  return res.json({ slot: updated });
}
