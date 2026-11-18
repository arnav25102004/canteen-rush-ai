import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

export type Diet = 'veg' | 'jain' | 'noegg';

/** Menu-item filter for a diet preference ("veg", "jain" or "noegg"). */
export function dietWhere(diet?: string | null): Prisma.MenuItemWhereInput {
  if (diet === 'veg') return { isVeg: true };
  if (diet === 'jain') return { isJain: true };
  if (diet === 'noegg') return { containsEgg: false };
  return {};
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether a time of day ("HH:MM") falls inside an availability window.
 * A missing bound means open-ended; a window that ends before it starts crosses midnight.
 */
export function isWithinWindow(from: string | null | undefined, to: string | null | undefined, hhmm: string): boolean {
  if (!from && !to) return true;
  const t = toMinutes(hhmm);
  if (from && !to) return t >= toMinutes(from);
  if (!from && to) return t <= toMinutes(to);
  const a = toMinutes(from as string);
  const b = toMinutes(to as string);
  return a <= b ? t >= a && t <= b : t >= a || t <= b;
}

/** A canteen's public menu: active categories with available items, plus its popular items. */
export async function getCanteenMenuData(canteenId: string, diet?: string | null) {
  const categories = await prisma.menuCategory.findMany({
    where: { canteenId, isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      items: {
        where: { isAvailable: true, ...dietWhere(diet) },
        orderBy: [{ sortOrder: 'asc' }, { totalOrders: 'desc' }],
      },
    },
  });

  const popular = await prisma.menuItem.findMany({
    where: { canteenId, isAvailable: true, isPopular: true },
    orderBy: { totalOrders: 'desc' },
    take: 5,
  });

  return { categories, popular };
}

/** The rules every student-facing item list shares: institution, active canteen and category, available, diet. */
export function visibleItemWhere(o: { institutionId: string; canteenId?: string; diet?: string | null }): Prisma.MenuItemWhereInput {
  return {
    isAvailable: true,
    canteen: { institutionId: o.institutionId, isActive: true },
    category: { isActive: true },
    ...(o.canteenId ? { canteenId: o.canteenId } : {}),
    ...dietWhere(o.diet),
  };
}

export interface MenuSearch {
  /** Only canteens of this institution are searched. */
  institutionId: string;
  canteenId?: string;
  text?: string;
  diet?: string | null;
  maxPrice?: number;
  maxPrepMinutes?: number;
  /** Pickup time of day ("HH:MM"): items whose category window excludes it are dropped. */
  at?: string;
  sort?: 'popular' | 'price_asc' | 'prep_asc';
  limit: number;
}

export interface MenuItemSummary {
  id: string;
  name: string;
  price: number;
  isVeg: boolean;
  isJain: boolean;
  containsEgg: boolean;
  prepTimeMinutes: number;
  canteenId: string;
  canteenName: string;
  categoryName: string;
  totalOrders: number;
}

/**
 * Menu search inside one institution: active canteens, available items, optional diet,
 * price, prep-time and pickup-time filters, ranked by how many words match and popularity.
 */
export async function searchMenuItems(q: MenuSearch): Promise<MenuItemSummary[]> {
  const tokens = (q.text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);

  const where: Prisma.MenuItemWhereInput = {
    ...visibleItemWhere({ institutionId: q.institutionId, canteenId: q.canteenId, diet: q.diet }),
    ...(q.maxPrice != null ? { price: { lte: q.maxPrice } } : {}),
    ...(q.maxPrepMinutes != null ? { prepTimeMinutes: { lte: q.maxPrepMinutes } } : {}),
    ...(tokens.length
      ? {
          OR: tokens.flatMap((t) => [
            { name: { contains: t, mode: 'insensitive' as const } },
            { description: { contains: t, mode: 'insensitive' as const } },
            { category: { name: { contains: t, mode: 'insensitive' as const } } },
          ]),
        }
      : {}),
  };

  const rows = await prisma.menuItem.findMany({
    where,
    take: 100,
    orderBy: { totalOrders: 'desc' },
    include: {
      canteen: { select: { name: true } },
      category: { select: { name: true, availableFrom: true, availableTo: true } },
    },
  });

  const at = q.at;
  const scored = rows
    .filter((r) => !at || isWithinWindow(r.category.availableFrom, r.category.availableTo, at))
    .map((r) => {
      const hay = `${r.name} ${r.description ?? ''} ${r.category.name}`.toLowerCase();
      const hits = tokens.filter((t) => hay.includes(t)).length;
      return { r, hits };
    });

  scored.sort((a, b) => {
    if (q.sort === 'price_asc') return Number(a.r.price) - Number(b.r.price);
    if (q.sort === 'prep_asc') return a.r.prepTimeMinutes - b.r.prepTimeMinutes;
    return b.hits - a.hits || b.r.totalOrders - a.r.totalOrders;
  });

  return scored.slice(0, q.limit).map(({ r }) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    isVeg: r.isVeg,
    isJain: r.isJain,
    containsEgg: r.containsEgg,
    prepTimeMinutes: r.prepTimeMinutes,
    canteenId: r.canteenId,
    canteenName: r.canteen.name,
    categoryName: r.category.name,
    totalOrders: r.totalOrders,
  }));
}
