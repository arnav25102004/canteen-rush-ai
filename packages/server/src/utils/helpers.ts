import { Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import crypto from 'crypto';

// Crockford-style alphabet: no 0/O, 1/I/L, or U, so codes read aloud at a
// noisy counter without ambiguity.
const PICKUP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PICKUP_LENGTH = 6;

/**
 * Pickup codes authorise collecting an order, so they need real entropy.
 * The previous CR-100..999 scheme had 900 values from Math.random(), which
 * collided constantly during a lunch rush and was trivially brute-forced.
 * This gives 30^6 ≈ 7.3e8 values from a CSPRNG.
 */
export function generatePickupCode(): string {
  let code = '';
  for (let i = 0; i < PICKUP_LENGTH; i++) {
    code += PICKUP_ALPHABET[crypto.randomInt(PICKUP_ALPHABET.length)];
  }
  return `CR-${code}`;
}

export function parsePagination(page: string = '1', limit: string = '20') {
  const int = (v: string, fallback: number) => (Number.isNaN(parseInt(v)) ? fallback : parseInt(v));
  const p = Math.max(1, int(page, 1));
  const l = Math.min(100, Math.max(1, int(limit, 20)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

/** Calendar date in IST as YYYYMMDD — used for daily order numbers. */
export function istDateKey(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Hour of day (0-23) in IST for an instant. */
export function istHour(at: Date = new Date()): number {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** Wall-clock time in IST as "HH:MM". */
export function istHHMM(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** IST calendar date as "YYYY-MM-DD", optionally shifted by whole days (0 = today, 1 = tomorrow). */
export function istDayString(offsetDays = 0, at: Date = new Date()): string {
  return new Date(at.getTime() + IST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Absolute start time of a pickup slot. slot.date is a calendar date; startTime is IST "HH:MM". */
export function slotStartsAt(slotDate: Date, startTime: string): Date {
  const { hours, minutes } = parseTimeString(startTime);
  return new Date(
    Date.UTC(slotDate.getUTCFullYear(), slotDate.getUTCMonth(), slotDate.getUTCDate(), hours, minutes) - IST_OFFSET_MS
  );
}

/** A paid-at-counter order is a no-show once its slot has ended this long ago. */
export const NO_SHOW_GRACE_MS = 60 * 60 * 1000;
export const NO_SHOW_STRIKE_LIMIT = 3;
export const NO_SHOW_BAN_MS = 7 * 24 * 60 * 60 * 1000;

/** Orders for a slot close this long before it starts. */
export const SLOT_CUTOFF_MS = 10 * 60 * 1000;

export function buildDateRange(date?: string | Date) {
  const IST_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

  let dateStr: string;
  if (!date) {
    dateStr = new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
  } else if (date instanceof Date) {
    dateStr = new Date(date.getTime() + IST_MS).toISOString().slice(0, 10);
  } else {
    dateStr = date;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  // IST midnight in UTC = subtract 5h30m from 00:00 IST
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_MS);
  const end   = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - IST_MS);
  return { gte: start, lte: end };
}

export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

export function emitOrderUpdate(
  io: SocketIOServer | undefined,
  orderId: string,
  canteenId: string,
  payload: Record<string, unknown>
) {
  if (!io) return;
  const update = { orderId, ...payload };
  io.to(`order:${orderId}`).emit('order:status_update', update);
  io.to(`canteen:${canteenId}`).emit('order:status_update', update);
}

export function generateTimeSlots(
  startH: number, startM: number,
  endH: number, endM: number,
  intervalMin: number,
  maxOrders: number
): Array<{ startTime: string; endTime: string; maxOrders: number }> {
  const slots = [];
  let h = startH, m = startM;
  while (h < endH || (h === endH && m <= endM)) {
    const nextM = m + intervalMin;
    const nextH = nextM >= 60 ? h + 1 : h;
    const nm = nextM % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    slots.push({ startTime: `${pad(h)}:${pad(m)}`, endTime: `${pad(nextH)}:${pad(nm)}`, maxOrders });
    h = nextH; m = nm;
  }
  return slots;
}

export function validateBody<T extends z.ZodTypeAny>(schema: T, body: unknown, res: Response):
  { success: true; data: z.infer<T> } | { success: false } {
  const parse = schema.safeParse(body);
  if (!parse.success) {
    res.status(400).json({ error: z.flattenError(parse.error) });
    return { success: false };
  }
  return { success: true, data: parse.data };
}
