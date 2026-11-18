import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { deleteAsset } from '../config/cloudinary';
import { logger } from '../utils/logger';
import { computeAvg } from './feedbackAggregates.service';

const DAY = 24 * 3600 * 1000;
export const CONTEXT_RETENTION_DAYS = 90;
export const BODY_RETENTION_MONTHS = 24;
export const PURGE_AFTER_DAYS = 30;
const BATCH = 200;
const MAX_BATCHES = 100; // per step per run; the next daily run continues

export interface RetentionCounts {
  contextCleared: number;
  bodiesCleared: number;
  attachmentsDeleted: number;
  purged: number;
}

/** Loop a batch step until it reports fewer rows than the batch size (or the safety cap). */
async function drain(step: () => Promise<number>, batch: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await step();
    total += n;
    if (n < batch) break;
  }
  return total;
}

export async function runRetention(now = new Date(), batch = BATCH): Promise<RetentionCounts> {
  const counts: RetentionCounts = { contextCleared: 0, bodiesCleared: 0, attachmentsDeleted: 0, purged: 0 };

  // 1. Diagnostics older than 90 days.
  const ctxCutoff = new Date(now.getTime() - CONTEXT_RETENTION_DAYS * DAY);
  counts.contextCleared = await drain(async () => {
    const rows = await prisma.feedback.findMany({
      where: { createdAt: { lt: ctxCutoff }, contextJson: { not: Prisma.DbNull } },
      select: { id: true }, take: batch,
    });
    if (!rows.length) return 0;
    await prisma.feedback.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { contextJson: Prisma.DbNull } });
    return rows.length;
  }, batch);

  // 2. Text and photos after 24 months. Ratings, tags and counts stay, so aggregates are untouched.
  const old = new Date(now);
  old.setMonth(old.getMonth() - BODY_RETENTION_MONTHS);
  counts.bodiesCleared = await drain(async () => {
    const rows = await prisma.feedback.findMany({
      where: {
        createdAt: { lt: old },
        OR: [{ body: { not: null } }, { bodyRedacted: { not: null } }, { attachments: { some: {} } }],
      },
      select: { id: true, attachments: { select: { id: true, publicId: true } } }, take: batch,
    });
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    for (const a of rows.flatMap((r) => r.attachments)) {
      if (a.publicId) await deleteAsset(a.publicId); // best effort, never throws
    }
    const del = await prisma.feedbackAttachment.deleteMany({ where: { feedbackId: { in: ids } } });
    counts.attachmentsDeleted += del.count;
    await prisma.feedback.updateMany({ where: { id: { in: ids } }, data: { body: null, bodyRedacted: null } });
    return rows.length;
  }, batch);

  // 3. Purge rows soft-deleted over 30 days ago. Their rating contribution was removed from the
  // aggregates at soft-delete time, and reconcile ignores deleted feedback, so the Rating rows go with them.
  const purgeCutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * DAY);
  counts.purged = await drain(async () => {
    const rows = await prisma.feedback.findMany({
      where: { deletedAt: { lt: purgeCutoff } },
      select: { id: true, attachments: { select: { publicId: true } } }, take: batch,
    });
    if (!rows.length) return 0;
    const ids = rows.map((r) => r.id);
    for (const a of rows.flatMap((r) => r.attachments)) {
      if (a.publicId) await deleteAsset(a.publicId);
    }
    await prisma.$transaction(async (tx) => {
      await tx.rating.deleteMany({ where: { feedbackId: { in: ids } } });
      await tx.feedbackEvent.deleteMany({ where: { feedbackId: { in: ids } } });
      await tx.feedbackReport.deleteMany({ where: { feedbackId: { in: ids } } });
      await tx.feedback.deleteMany({ where: { id: { in: ids }, deletedAt: { lt: purgeCutoff } } });
    });
    return rows.length;
  }, batch);

  logger.info('[Retention] feedback retention run', counts);
  return counts;
}

// Nightly aggregate reconcile

const LIVE_FEEDBACK = { deletedAt: null, moderation: { not: 'HIDDEN' as const } };

export interface ReconcileResult { itemsChecked: number; canteensChecked: number; itemsFixed: number; canteensFixed: number }

/**
 * Recompute MenuItem and Canteen rating aggregates from the source rows (hidden and deleted
 * feedback excluded) and write only the rows that differ. Any drift is logged as a warning.
 */
export async function reconcileAggregates(): Promise<ReconcileResult> {
  return prisma.$transaction(async (tx) => {
    const itemAgg = await tx.rating.groupBy({
      by: ['menuItemId'], where: { feedback: LIVE_FEEDBACK }, _sum: { rating: true }, _count: { _all: true },
    });
    const canteenAgg = await tx.feedback.groupBy({
      by: ['canteenId'],
      where: { ...LIVE_FEEDBACK, kind: { in: ['ORDER_REVIEW', 'CANTEEN'] }, canteenId: { not: null }, overallRating: { not: null } },
      _sum: { overallRating: true }, _count: { _all: true },
    });
    const wantItem = new Map(itemAgg.map((r) => [r.menuItemId, { sum: r._sum.rating ?? 0, count: r._count._all }]));
    const wantCanteen = new Map(canteenAgg.map((r) => [r.canteenId as string, { sum: r._sum.overallRating ?? 0, count: r._count._all }]));

    const items = await tx.menuItem.findMany({ select: { id: true, ratingSum: true, totalRatings: true, avgRating: true } });
    const canteens = await tx.canteen.findMany({ select: { id: true, ratingSum: true, totalRatings: true, avgRating: true } });

    let itemsFixed = 0;
    let canteensFixed = 0;
    for (const it of items) {
      const w = wantItem.get(it.id) ?? { sum: 0, count: 0 };
      const avg = computeAvg(w.sum, w.count);
      if (it.ratingSum === w.sum && it.totalRatings === w.count && Number(it.avgRating) === avg) continue;
      logger.warn('[Reconcile] menu item rating drift', { id: it.id, had: { sum: it.ratingSum, count: it.totalRatings }, want: w });
      await tx.menuItem.update({ where: { id: it.id }, data: { ratingSum: w.sum, totalRatings: w.count, avgRating: avg } });
      itemsFixed++;
    }
    for (const c of canteens) {
      const w = wantCanteen.get(c.id) ?? { sum: 0, count: 0 };
      const avg = computeAvg(w.sum, w.count);
      if (c.ratingSum === w.sum && c.totalRatings === w.count && Number(c.avgRating) === avg) continue;
      logger.warn('[Reconcile] canteen rating drift', { id: c.id, had: { sum: c.ratingSum, count: c.totalRatings }, want: w });
      await tx.canteen.update({ where: { id: c.id }, data: { ratingSum: w.sum, totalRatings: w.count, avgRating: avg } });
      canteensFixed++;
    }
    const result = { itemsChecked: items.length, canteensChecked: canteens.length, itemsFixed, canteensFixed };
    logger.info('[Reconcile] feedback aggregates', result);
    return result;
  }, { timeout: 120_000 });
}
