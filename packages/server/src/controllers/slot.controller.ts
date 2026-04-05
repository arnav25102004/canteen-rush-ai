import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getSlotAvailability, generateSlotsForCanteen } from '../services/slot.service';
import { z } from 'zod';

export async function listSlotsForCanteen(req: Request, res: Response) {
  const { id: canteenId } = req.params;
  const { date } = req.query;

  const targetDate = date ? new Date(date as string) : new Date();
  // Normalize to midnight UTC
  targetDate.setUTCHours(0, 0, 0, 0);

  const now = new Date();
  const cutoffMs = 10 * 60 * 1000; // 10 min cut-off before slot start

  const slots = await prisma.pickupSlot.findMany({
    where: { canteenId, date: targetDate },
    orderBy: { startTime: 'asc' },
  });

  const enriched = await Promise.all(
    slots.map(async (slot) => {
      const avail = await getSlotAvailability(slot.id);

      // Check if cut-off passed
      const [sh, sm] = slot.startTime.split(':').map(Number);
      const slotDateTime = new Date(targetDate);
      slotDateTime.setHours(sh, sm, 0, 0);
      const isCutoffPassed = slotDateTime.getTime() - now.getTime() < cutoffMs;

      return { ...avail, isCutoffPassed };
    })
  );

  return res.json({ slots: enriched, date: targetDate.toISOString().split('T')[0] });
}

export async function generateSlots(req: AuthRequest, res: Response) {
  const canteenId = req.user!.canteenId;
  if (!canteenId) return res.status(403).json({ error: 'No canteen assigned' });

  const schema = z.object({
    startDate: z.string(),
    endDate: z.string(),
    slots: z.array(z.object({
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      maxOrders: z.number().int().positive(),
      walkInReserved: z.number().int().optional(),
    })),
  });

  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const { startDate, endDate, slots } = parse.data;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const created: any[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const daySlots = await generateSlotsForCanteen(canteenId, new Date(d), slots);
    created.push(...daySlots);
  }

  return res.json({ created: created.length, slots: created });
}

export async function updateSlot(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const schema = z.object({
    maxOrders: z.number().int().positive().optional(),
    walkInReserved: z.number().int().optional(),
  });

  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });

  const slot = await prisma.pickupSlot.update({ where: { id }, data: parse.data });
  return res.json({ slot });
}

export async function toggleSlot(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const slot = await prisma.pickupSlot.findUnique({ where: { id } });
  if (!slot) return res.status(404).json({ error: 'Slot not found' });

  const updated = await prisma.pickupSlot.update({
    where: { id },
    data: { isOpen: !slot.isOpen },
  });
  return res.json({ slot: updated });
}
