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
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
}

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
  io.to(`order:${orderId}`).emit('order:status_update', payload);
  io.to(`canteen:${canteenId}`).emit('order:status_update', { orderId, ...payload });
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
    res.status(400).json({ error: parse.error.flatten() });
    return { success: false };
  }
  return { success: true, data: parse.data };
}
