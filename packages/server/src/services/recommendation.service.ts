import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { isWithinWindow, MenuItemSummary, visibleItemWhere } from './menu.service';

export interface Recommendation extends MenuItemSummary {
  reason: 'usual' | 'popular';
}

export interface RecommendationQuery {
  userId: string;
  institutionId: string;
  diet?: string | null;
  canteenId?: string;
  /** Pickup time of day ("HH:MM"). */
  at: string;
  limit: number;
}

const HISTORY_DAYS = 90;

const include = {
  canteen: { select: { name: true } },
  category: { select: { name: true, availableFrom: true, availableTo: true } },
} as const;

type Row = Awaited<ReturnType<typeof prisma.menuItem.findMany<{ include: typeof include }>>>[number];

function summarise(r: Row, reason: Recommendation['reason']): Recommendation {
  return {
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
    reason,
  };
}

/**
 * What to suggest: the student's own most-ordered items of the last 90 days ("usual"), then
 * popular items. Both go through the same rules as menu search (institution, active canteen,
 * available, diet, category window at `at`), so a stale favourite is never suggested.
 */
export async function getRecommendations(q: RecommendationQuery): Promise<Recommendation[]> {
  const where = visibleItemWhere({ institutionId: q.institutionId, canteenId: q.canteenId, diet: q.diet });
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const inWindow = (r: Row) => isWithinWindow(r.category.availableFrom, r.category.availableTo, q.at);

  const history = await prisma.orderItem.groupBy({
    by: ['menuItemId'],
    where: { order: { userId: q.userId, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.NO_SHOW] }, createdAt: { gte: since } } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 30,
  });

  const out: Recommendation[] = [];
  const seen = new Set<string>();

  if (history.length > 0) {
    const rows = await prisma.menuItem.findMany({ where: { ...where, id: { in: history.map((h) => h.menuItemId) } }, include });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const h of history) {
      const r = byId.get(h.menuItemId);
      if (!r || !inWindow(r) || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(summarise(r, 'usual'));
      if (out.length >= q.limit) return out;
    }
  }

  const popular = await prisma.menuItem.findMany({
    where: { ...where, ...(seen.size ? { id: { notIn: [...seen] } } : {}) },
    orderBy: [{ isPopular: 'desc' }, { totalOrders: 'desc' }],
    take: q.limit * 3,
    include,
  });
  for (const r of popular) {
    if (!inWindow(r) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(summarise(r, 'popular'));
    if (out.length >= q.limit) break;
  }
  return out;
}
