import { prisma } from '../config/database';
import { redis, KEYS } from '../config/redis';
import { generateTimeSlots } from '../utils/helpers';

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
  const cached = await redis.get(KEYS.slotAvailability(slotId));
  if (cached) return JSON.parse(cached);

  const slot = await prisma.pickupSlot.findUnique({ where: { id: slotId } });
  if (!slot) return null;

  const preOrderCapacity = slot.maxOrders - slot.walkInReserved;
  const available = Math.max(0, preOrderCapacity - slot.currentOrders);
  const fillPercentage = preOrderCapacity > 0
    ? Math.round((slot.currentOrders / preOrderCapacity) * 100)
    : 100;

  const availability: SlotAvailability = {
    slotId,
    startTime: slot.startTime,
    endTime: slot.endTime,
    date: slot.date.toISOString().split('T')[0],
    totalCapacity: slot.maxOrders,
    preOrderCapacity,
    booked: slot.currentOrders,
    available,
    fillPercentage,
    isFull: available <= 0,
    isOpen: slot.isOpen,
  };

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
  }
  return created;
}

export async function generateDefaultSlots(canteenId: string, date: Date) {
  const breakfastSlots = generateTimeSlots(7, 45, 10, 30, 15, 25);
  const lunchSlots = generateTimeSlots(12, 0, 14, 30, 15, 30);
  return generateSlotsForCanteen(canteenId, date, [...breakfastSlots, ...lunchSlots]);
}

export async function incrementSlotOrders(slotId: string): Promise<boolean> {
  const slot = await prisma.pickupSlot.findUnique({
    where: { id: slotId },
    select: { maxOrders: true, walkInReserved: true, currentOrders: true, isOpen: true },
  });
  if (!slot || !slot.isOpen) return false;

  const preOrderCap = slot.maxOrders - slot.walkInReserved;
  if (slot.currentOrders >= preOrderCap) return false;

  await prisma.pickupSlot.update({ where: { id: slotId }, data: { currentOrders: { increment: 1 } } });
  await redis.del(KEYS.slotAvailability(slotId));
  return true;
}

export async function decrementSlotOrders(slotId: string) {
  await prisma.pickupSlot.update({ where: { id: slotId }, data: { currentOrders: { decrement: 1 } } });
  await redis.del(KEYS.slotAvailability(slotId));
}
