import { prisma } from '../config/database';
import { redis, KEYS } from '../config/redis';

interface SlotAvailability {
  slotId: string;
  startTime: string;
  endTime: string;
  date: string;
  totalCapacity: number;
  preOrderCapacity: number;
  booked: number;
  available: number;
  fillPercentage: number;
  isFull: boolean;
  isOpen: boolean;
}

export async function getSlotAvailability(slotId: string): Promise<SlotAvailability | null> {
  // Try cache first
  const cached = await redis.get(KEYS.slotAvailability(slotId));
  if (cached) return JSON.parse(cached);

  const slot = await prisma.pickupSlot.findUnique({ where: { id: slotId } });
  if (!slot) return null;

  const preOrderCapacity = slot.maxOrders - slot.walkInReserved;
  const available = Math.max(0, preOrderCapacity - slot.currentOrders);
  const fillPct = preOrderCapacity > 0 ? Math.round((slot.currentOrders / preOrderCapacity) * 100) : 100;

  const availability: SlotAvailability = {
    slotId,
    startTime: slot.startTime,
    endTime: slot.endTime,
    date: slot.date.toISOString().split('T')[0],
    totalCapacity: slot.maxOrders,
    preOrderCapacity,
    booked: slot.currentOrders,
    available,
    fillPercentage: fillPct,
    isFull: available <= 0,
    isOpen: slot.isOpen,
  };

  // Cache for 30 seconds
  await redis.setex(KEYS.slotAvailability(slotId), 30, JSON.stringify(availability));
  return availability;
}

export async function generateSlotsForCanteen(
  canteenId: string,
  date: Date,
  slots: Array<{ startTime: string; endTime: string; maxOrders: number; walkInReserved?: number }>
) {
  const created = [];
  for (const slot of slots) {
    try {
      const s = await prisma.pickupSlot.upsert({
        where: { canteenId_date_startTime: { canteenId, date, startTime: slot.startTime } },
        update: {},
        create: {
          canteenId,
          date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          maxOrders: slot.maxOrders,
          walkInReserved: slot.walkInReserved ?? Math.floor(slot.maxOrders * 0.3),
        },
      });
      created.push(s);
    } catch {
      // Slot already exists, skip
    }
  }
  return created;
}

export async function generateDefaultSlots(canteenId: string, date: Date) {
  const breakfastSlots = [];
  const lunchSlots = [];

  // Breakfast: 07:45 – 10:30, every 15 min, 25 max
  for (let h = 7; h <= 10; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 7 && m < 45) continue;
      if (h === 10 && m > 30) break;
      const start = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const endM = m + 15;
      const endH = endM >= 60 ? h + 1 : h;
      const end = `${String(endH).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
      breakfastSlots.push({ startTime: start, endTime: end, maxOrders: 25 });
    }
  }

  // Lunch: 12:00 – 14:30, every 15 min, 30 max
  for (let h = 12; h <= 14; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 14 && m > 30) break;
      const start = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const endM = m + 15;
      const endH = endM >= 60 ? h + 1 : h;
      const end = `${String(endH).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
      lunchSlots.push({ startTime: start, endTime: end, maxOrders: 30 });
    }
  }

  return generateSlotsForCanteen(canteenId, date, [...breakfastSlots, ...lunchSlots]);
}

export async function incrementSlotOrders(slotId: string): Promise<boolean> {
  const slot = await prisma.pickupSlot.findUnique({ where: { id: slotId } });
  if (!slot) return false;

  const preOrderCap = slot.maxOrders - slot.walkInReserved;
  if (slot.currentOrders >= preOrderCap) return false; // Full

  await prisma.pickupSlot.update({
    where: { id: slotId },
    data: { currentOrders: { increment: 1 } },
  });

  // Invalidate cache
  await redis.del(KEYS.slotAvailability(slotId));
  return true;
}

export async function decrementSlotOrders(slotId: string) {
  await prisma.pickupSlot.update({
    where: { id: slotId },
    data: { currentOrders: { decrement: 1 } },
  });
  await redis.del(KEYS.slotAvailability(slotId));
}
