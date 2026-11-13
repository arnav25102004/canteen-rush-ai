import { prisma } from '../config/database';
import { cacheGet, cacheSet, slotCacheKeys } from '../config/redis';
import { generateTimeSlots } from '../utils/helpers';
import { UserRole } from '@prisma/client';

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

export async function getSlotAvailability(slotId: string, userRole?: UserRole): Promise<SlotAvailability | null> {
  const isFaculty = userRole === UserRole.FACULTY || userRole === UserRole.ADMIN;
  const [studentKey, facultyKey] = slotCacheKeys(slotId);
  const cacheKey = isFaculty ? facultyKey : studentKey;

  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const slot = await prisma.pickupSlot.findUnique({ where: { id: slotId } });
  if (!slot) return null;

  // Faculty can use both general + faculty-reserved slots; students cannot use faculty-reserved
  const preOrderCapacity = isFaculty
    ? slot.maxOrders - slot.walkInReserved
    : slot.maxOrders - slot.walkInReserved - slot.facultyReserved;

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

  await cacheSet(cacheKey, 30, JSON.stringify(availability));
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
