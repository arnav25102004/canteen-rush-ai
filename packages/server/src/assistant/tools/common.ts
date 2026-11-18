import { z } from 'zod';
import { AppError } from '../../utils/errors';
import { clipName } from './registry';

export const MAX_ROWS = 8;

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use 24h HH:MM');
export const ref = z.string().min(2).max(6);

/** V veg, J jain, E veg with egg, N non-veg. */
export function dietCode(i: { isVeg: boolean; isJain: boolean; containsEgg: boolean }): 'V' | 'J' | 'E' | 'N' {
  if (!i.isVeg) return 'N';
  if (i.containsEgg) return 'E';
  if (i.isJain) return 'J';
  return 'V';
}

export function name(s: string) {
  return clipName(s);
}

/** Compact rows. `more` counts rows that existed but were not shown. Empty gives {rows:[],found:0}. */
export function rowsResult(cols: string, rows: unknown[][], total: number = rows.length, extra: Record<string, unknown> = {}) {
  if (rows.length === 0) return { rows: [], found: 0, ...extra };
  const shown = rows.slice(0, MAX_ROWS);
  return { ...extra, cols, rows: shown, more: Math.max(0, total - shown.length) };
}

export function parseHHMMToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function assertFound<T>(v: T | null | undefined, message = 'not found'): T {
  if (v == null) throw new AppError(404, message);
  return v;
}
