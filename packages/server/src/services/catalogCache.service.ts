import { prisma } from '../config/database';
import { cached, CacheOptions, invalidate, writeThrough } from '../config/cache';
import { getCanteenMenuData } from './menu.service';
import { logger } from '../utils/logger';

type IoLike = { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
type Menu = Awaited<ReturnType<typeof getCanteenMenuData>>;

const DIETS = ['all', 'veg', 'jain', 'noegg'] as const;
type DietKey = (typeof DIETS)[number];

// An unknown id gives an empty menu; caching those would let random ids fill the cache.
const MENU_CACHE: CacheOptions<Menu> = { ttl: 60, stale: 300, cacheIf: (m) => m.categories.length > 0 };

const dietKey = (diet?: string | null): DietKey =>
  (DIETS as readonly string[]).includes(diet ?? '') ? (diet as DietKey) : 'all';
const menuKey = (canteenId: string, diet: DietKey) => `menu:${canteenId}:${diet}`;
const loadMenu = (canteenId: string, diet: DietKey) => () =>
  getCanteenMenuData(canteenId, diet === 'all' ? null : diet);

export const canteenKey = (id: string) => `canteen:${id}`;
export const CANTEEN_LIST_KEY = 'canteens:active';
export const slotsKey = (canteenId: string, day: string) => `slots:${canteenId}:${day}`;

export function getCachedMenu(canteenId: string, diet?: string | null) {
  const d = dietKey(diet);
  return cached(menuKey(canteenId, d), loadMenu(canteenId, d), MENU_CACHE);
}

/**
 * Write-through for a vendor's menu change. Call after the DB commit: every diet
 * view is rebuilt before the vendor gets a response, and connected students are
 * told to update. Never throws.
 */
export async function refreshMenu(canteenId: string, io?: IoLike, change?: Record<string, unknown>) {
  await Promise.all(DIETS.map((d) => writeThrough(menuKey(canteenId, d), loadMenu(canteenId, d), MENU_CACHE)));
  try {
    io?.to(`menu:${canteenId}`).emit('menu:updated', { canteenId, ...change });
  } catch (err) {
    logger.warn('menu:updated emit failed', { canteenId, err: (err as Error)?.message });
  }
}

/** Canteen rows changed: the list and detail views reload on next read. */
export function refreshCanteen(id: string) {
  return invalidate(CANTEEN_LIST_KEY, canteenKey(id));
}

export function invalidateSlots(canteenId: string, date: Date | string) {
  const day = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  return invalidate(slotsKey(canteenId, day));
}

/** Slot rows for one calendar day. Display only: capacity is always enforced by the DB. */
export function loadSlotRows(canteenId: string, day: string) {
  return prisma.pickupSlot.findMany({
    where: { canteenId, date: new Date(`${day}T00:00:00.000Z`) },
    orderBy: { startTime: 'asc' },
  });
}
