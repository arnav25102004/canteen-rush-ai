import { Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';

export function parsePagination(page: string = '1', limit: string = '20') {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
}

export function buildDateRange(date?: string | Date) {
  const d = date ? new Date(date) : new Date();
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);
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
