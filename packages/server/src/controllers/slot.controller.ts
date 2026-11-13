import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest, canteenScope } from '../middleware/auth';
import { cacheDel, slotCacheKeys } from '../config/redis';
import { getSlotAvailability, generateSlotsForCanteen } from '../services/slot.service';
import { istDateKey, slotStartsAt, SLOT_CUTOFF_MS, validateBody } from '../utils/helpers';
import { z } from 'zod';

const MAX_SLOT_RANGE_DAYS = 31;

const generateSlotsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z.array(z.object({
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    maxOrders: z.number().int().positive().max(1000),
    walkInReserved: z.number().int().min(0).optional(),
  })).max(100),
});

const updateSlotSchema = z.object({
  maxOrders: z.number().int().positive().max(1000).optional(),
  walkInReserved: z.number().int().min(0).optional(),
});

export async function listSlotsForCanteen(req: AuthRequest, res: Response) {
  const { id: canteenId } = req.params;
  const { date } = req.query;
  const userRole = req.user?.role;

  // Calendar date (YYYY-MM-DD, IST); defaults to today in IST
  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : istDateKey().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const targetDate = new Date(`${day}T00:00:00.000Z`);

  const slots = await prisma.pickupSlot.findMany({
    where: { canteenId, date: targetDate },
    orderBy: { startTime: 'asc' },
  });

  // Fetch all availabilities in parallel, passing user role for faculty priority
  const availabilities = await Promise.all(slots.map((s) => getSlotAvailability(s.id, userRole)));

  const now = Date.now();
  const enriched = slots.map((slot, i) => ({
    ...availabilities[i],
    isCutoffPassed: slotStartsAt(slot.date, slot.startTime).getTime() - now < SLOT_CUTOFF_MS,
  }));

  return res.json({ slots: enriched, date: targetDate.toISOString().split('T')[0] });
}

export async function generateSlots(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const v = validateBody(generateSlotsSchema, req.body, res);
  if (!v.success) return;

  const { startDate, endDate, slots } = v.data;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (!(days >= 0 && days < MAX_SLOT_RANGE_DAYS)) {
    return res.status(400).json({ error: `Date range must be 1-${MAX_SLOT_RANGE_DAYS} days` });
  }
  const created: Awaited<ReturnType<typeof generateSlotsForCanteen>> = [];

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const daySlots = await generateSlotsForCanteen(canteenId, new Date(d), slots);
    created.push(...daySlots);
  }

  return res.json({ created: created.length, slots: created });
}

export async function updateSlot(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const scope = canteenScope(req);
  if (!scope) return res.status(403).json({ error: 'No canteen assigned' });
  const v = validateBody(updateSlotSchema, req.body, res);
  if (!v.success) return;

  const { count } = await prisma.pickupSlot.updateMany({ where: { id, ...scope }, data: v.data });
  if (count === 0) return res.status(404).json({ error: 'Slot not found' });
  await cacheDel(...slotCacheKeys(id));
  return res.json({ slot: await prisma.pickupSlot.findUnique({ where: { id } }) });
}

export async function toggleSlot(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const scope = canteenScope(req);
  if (!scope) return res.status(403).json({ error: 'No canteen assigned' });
  const slot = await prisma.pickupSlot.findFirst({ where: { id, ...scope }, select: { isOpen: true } });
  if (!slot) return res.status(404).json({ error: 'Slot not found' });

  const updated = await prisma.pickupSlot.update({ where: { id }, data: { isOpen: !slot.isOpen } });
  await cacheDel(...slotCacheKeys(id));
  return res.json({ slot: updated });
}
