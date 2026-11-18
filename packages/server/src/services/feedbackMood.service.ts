import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { FEEDBACK_TAGS } from '../utils/feedbackSchemas';

export const MOOD_MIN_RATINGS = 10;
export const MOOD_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Hidden, flagged and deleted feedback never counts toward a public score. */
const MOOD_WHERE = {
  deletedAt: null,
  kind: { in: ['ORDER_REVIEW', 'CANTEEN'] as ('ORDER_REVIEW' | 'CANTEEN')[] },
  moderation: { notIn: ['FLAGGED', 'HIDDEN'] as ('FLAGGED' | 'HIDDEN')[] },
  overallRating: { not: null },
};

/** One decimal place, or null when there are too few ratings to be fair to the canteen. */
export function moodValue(avg: number | null | undefined, count: number): number | null {
  if (avg == null || count < MOOD_MIN_RATINGS) return null;
  return Math.round(avg * 10) / 10;
}

/** Moods for many canteens in ONE grouped query (used by the canteen list; never N+1). */
export async function getMoodsForCanteens(canteenIds: string[], now = new Date()) {
  const out = new Map<string, { mood: number | null; moodCount: number }>();
  if (!canteenIds.length) return out;
  const rows = await prisma.feedback.groupBy({
    by: ['canteenId'],
    where: { ...MOOD_WHERE, canteenId: { in: canteenIds }, createdAt: { gte: new Date(now.getTime() - MOOD_WINDOW_MS) } },
    _avg: { overallRating: true },
    _count: { _all: true },
  });
  for (const r of rows) {
    if (!r.canteenId) continue;
    out.set(r.canteenId, { mood: moodValue(r._avg.overallRating, r._count._all), moodCount: r._count._all });
  }
  return out;
}

/** Aggregate only: never any text. Tags are shown only once the score itself is. */
export async function getCanteenSummary(canteenId: string, institutionId: string | null | undefined, now = new Date()) {
  const canteen = await prisma.canteen.findFirst({
    where: { id: canteenId, ...(institutionId ? { institutionId } : {}) },
    select: { id: true },
  });
  if (!canteen) throw new AppError(404, 'Canteen not found');

  const since = new Date(now.getTime() - MOOD_WINDOW_MS);
  const where = { ...MOOD_WHERE, canteenId, createdAt: { gte: since } };
  const agg = await prisma.feedback.aggregate({ where, _avg: { overallRating: true }, _count: { _all: true } });
  const count = agg._count._all;
  const mood = moodValue(agg._avg.overallRating, count);
  if (mood == null) return { mood: null, count, tags: [] as { tag: string; count: number }[], window: '7d' as const };

  const rows = await prisma.feedback.findMany({ where, select: { tags: true }, take: 2000 });
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of r.tags) if (FEEDBACK_TAGS.includes(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag, c]) => ({ tag, count: c }));
  return { mood, count, tags, window: '7d' as const };
}
