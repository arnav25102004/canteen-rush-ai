import { prisma } from '../config/database';
import { cached } from '../config/cache';
import { invalidateSlots, loadSlotRows, slotsKey } from './catalogCache.service';
import { generateTimeSlots, slotStartsAt, SLOT_CUTOFF_MS } from '../utils/helpers';
import { UserRole } from '@prisma/client';

export interface SlotAvailability {
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

interface SlotRow {
  id: string;
  date: Date | string;
  startTime: string;
  endTime: string;
  maxOrders: number;
  walkInReserved: number;
  facultyReserved: number;
  currentOrders: number;
  isOpen: boolean;
}

function toAvailability(slot: SlotRow, isFaculty: boolean): SlotAvailability {
  // Faculty can use both general + faculty-reserved slots; students cannot use faculty-reserved
  const preOrderCapacity = isFaculty
    ? slot.maxOrders - slot.walkInReserved
    : slot.maxOrders - slot.walkInReserved - slot.facultyReserved;

  const available = Math.max(0, preOrderCapacity - slot.currentOrders);
  const fillPercentage = preOrderCapacity > 0
    ? Math.round((slot.currentOrders / preOrderCapacity) * 100)
    : 100;

  return {
    slotId: slot.id,
    startTime: slot.startTime,
    endTime: slot.endTime,
    date: new Date(slot.date).toISOString().split('T')[0],
    totalCapacity: slot.maxOrders,
    preOrderCapacity,
    booked: slot.currentOrders,
    available,
    fillPercentage,
    isFull: available <= 0,
    isOpen: slot.isOpen,
  };
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
  await invalidateSlots(canteenId, date);
  return created;
}

export async function generateDefaultSlots(canteenId: string, date: Date) {
  const breakfastSlots = generateTimeSlots(7, 45, 10, 30, 15, 25);
  const lunchSlots = generateTimeSlots(12, 0, 14, 30, 15, 30);
  return generateSlotsForCanteen(canteenId, date, [...breakfastSlots, ...lunchSlots]);
}

export type SlotWithCutoff = SlotAvailability & { isCutoffPassed: boolean };

/**
 * All pickup slots of a canteen on a calendar day (IST, "YYYY-MM-DD"), with availability for
 * the caller's role and whether ordering for each has closed.
 */
export async function listSlotsWithAvailability(
  canteenId: string,
  day: string,
  userRole?: UserRole,
  now: number = Date.now(),
): Promise<{ slots: SlotWithCutoff[]; date: string }> {
  const targetDate = new Date(`${day}T00:00:00.000Z`);
  // One cached row set for every role; availability and cutoff are computed per request.
  const slots = await cached<SlotRow[]>(slotsKey(canteenId, day), () => loadSlotRows(canteenId, day), {
    ttl: 5,
    stale: 30,
    cacheIf: (rows) => rows.length > 0,
  });
  const isFaculty = userRole === UserRole.FACULTY || userRole === UserRole.ADMIN;

  const enriched: SlotWithCutoff[] = slots.map((slot) => ({
    ...toAvailability(slot, isFaculty),
    isCutoffPassed: slotStartsAt(new Date(slot.date), slot.startTime).getTime() - now < SLOT_CUTOFF_MS,
  }));

  return { slots: enriched, date: targetDate.toISOString().split('T')[0] };
}
