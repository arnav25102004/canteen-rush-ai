import { AttachmentStatus, FeedbackKind, FeedbackModeration, FeedbackVisibility, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { cleanText, graphemeLength } from '../utils/feedbackSchemas';
import { moderateText } from './feedbackModeration.service';
import { notifyUser } from './notification.service';
import { logger } from '../utils/logger';

/**
 * Vendor view of feedback. The DTO is a whitelist: rating, item ratings, tags, redacted text,
 * approved photos and the calendar day. Never who wrote it, which order or slot it came from, or
 * the exact time, and anonymous or not makes no difference.
 */

const HOUR = 3600 * 1000;
const IST_OFFSET_MS = 5.5 * HOUR;
export const LOW_RATING_DELAY_MS = 3 * HOUR;
export const VENDOR_REPLY_MAX = 300;
export const REPLY_PUBLIC = 'REPLY_PUBLIC';
export const FLAG_UNFAIR_REASON_MAX = 300;

/** IST calendar day, YYYY-MM-DD. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** What a vendor may see right now: not hidden or admin-only, and 1-2 star items only after the delay. */
export function vendorVisibleWhere(canteenId: string, now: Date): Prisma.FeedbackWhereInput {
  const cutoff = new Date(now.getTime() - LOW_RATING_DELAY_MS);
  return {
    canteenId,
    deletedAt: null,
    kind: { in: [FeedbackKind.ORDER_REVIEW, FeedbackKind.CANTEEN] },
    visibility: { in: [FeedbackVisibility.VENDOR, FeedbackVisibility.PUBLIC] },
    moderation: { not: FeedbackModeration.HIDDEN },
    OR: [{ overallRating: null }, { overallRating: { gte: 3 } }, { createdAt: { lte: cutoff } }],
  };
}

export function toVendorDto(fb: any) {
  const reply = (fb.events ?? []).find((e: any) => e.type === REPLY_PUBLIC);
  const text = fb.body ? (fb.bodyRedacted ?? moderateText(fb.body).redacted) : null;
  return {
    id: fb.id,
    kind: fb.kind,
    rating: fb.overallRating ?? null,
    tags: fb.tags ?? [],
    text: text || null,
    day: istDay(new Date(fb.createdAt)),
    items: (fb.ratings ?? []).map((r: any) => ({
      item: r.menuItem?.name ?? null, rating: r.rating, taste: r.taste ?? null, portion: r.portion ?? null,
      value: r.value ?? null, tags: r.tags ?? [],
    })),
    photos: (fb.attachments ?? []).filter((a: any) => a.status === AttachmentStatus.APPROVED).map((a: any) => a.url),
    reply: reply ? { text: reply.note, by: (reply.data as any)?.by ?? null, day: istDay(new Date(reply.createdAt)) } : null,
  };
}

export async function listVendorFeedback(canteenId: string, page: number, limit: number, now = new Date()) {
  const where = vendorVisibleWhere(canteenId, now);
  const [rows, total] = await Promise.all([
    prisma.feedback.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      select: {
        id: true, kind: true, overallRating: true, tags: true, body: true, bodyRedacted: true, createdAt: true,
        ratings: { select: { rating: true, taste: true, portion: true, value: true, tags: true, menuItem: { select: { name: true } } } },
        attachments: { select: { url: true, status: true } },
        events: { where: { type: REPLY_PUBLIC }, select: { type: true, note: true, data: true, createdAt: true } },
      },
    }),
    prisma.feedback.count({ where }),
  ]);
  return { feedback: rows.map(toVendorDto), page, limit, total };
}

async function loadVisible(canteenId: string, id: string, now: Date) {
  const fb = await prisma.feedback.findFirst({
    where: { id, ...vendorVisibleWhere(canteenId, now) },
    select: { id: true, userId: true },
  });
  if (!fb) throw new AppError(404, 'Feedback not found');
  return fb;
}

/** One public reply per feedback, 300 characters at most, moderated (profanity masked, PII removed). */
export async function replyToFeedback(
  vendor: { id: string; canteenId: string }, id: string, text: string, now = new Date(),
) {
  const fb = await loadVisible(vendor.canteenId, id, now);
  const cleaned = cleanText(text);
  if (!cleaned) throw new AppError(400, 'Reply is empty');
  if (graphemeLength(cleaned) > VENDOR_REPLY_MAX) throw new AppError(400, `Max ${VENDOR_REPLY_MAX} characters`);
  const m = moderateText(cleaned);
  const note = m.redacted;
  const canteen = await prisma.canteen.findUnique({ where: { id: vendor.canteenId }, select: { name: true } });

  const ev = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'fbreply:' + id}))`;
    const existing = await tx.feedbackEvent.findFirst({ where: { feedbackId: id, type: REPLY_PUBLIC }, select: { id: true } });
    if (existing) throw new AppError(409, 'You already replied to this feedback', 'REPLY_EXISTS');
    return tx.feedbackEvent.create({
      data: {
        feedbackId: id, actorId: vendor.id, type: REPLY_PUBLIC, note, isInternal: false,
        data: { by: canteen?.name ?? 'Canteen', flagged: m.flagged },
      },
    });
  });

  if (fb.userId) {
    notifyUser(fb.userId, {
      title: 'The canteen replied to your review',
      body: note.length > 140 ? `${note.slice(0, 140)}…` : note,
      type: 'feedback_update',
      data: { feedbackId: id, reply: true },
    }).catch((err) => logger.warn('Vendor reply notification failed', { err: (err as Error)?.message }));
  }
  return { reply: { text: note, by: canteen?.name ?? 'Canteen', day: istDay(ev.createdAt) } };
}

/** Sends the item to admin review as a report. Hides nothing; one flag per vendor per item. */
export async function flagUnfair(vendor: { id: string; canteenId: string }, id: string, reason: string, now = new Date()) {
  await loadVisible(vendor.canteenId, id, now);
  const text = cleanText(reason);
  if (graphemeLength(text) > FLAG_UNFAIR_REASON_MAX) throw new AppError(400, `Max ${FLAG_UNFAIR_REASON_MAX} characters`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.feedbackReport.create({
        data: { feedbackId: id, reporterId: vendor.id, reason: `UNFAIR (vendor): ${text || 'no reason given'}` },
      });
      await tx.feedbackEvent.create({
        data: { feedbackId: id, actorId: vendor.id, type: 'vendor_flagged_unfair', isInternal: true, note: text || null },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { flagged: true, alreadyFlagged: true };
    throw err;
  }
  return { flagged: true, alreadyFlagged: false };
}

/** Mood trend per IST day and the most used tags. Uses the same visibility rules as the list. */
export async function vendorSummary(canteenId: string, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * HOUR);
  const rows = await prisma.feedback.findMany({
    where: { ...vendorVisibleWhere(canteenId, now), createdAt: { gte: since } },
    select: { overallRating: true, tags: true, createdAt: true },
    take: 5000,
  });
  const perDay = new Map<string, { sum: number; count: number }>();
  const tagCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.overallRating != null) {
      const d = istDay(r.createdAt);
      const cur = perDay.get(d) ?? { sum: 0, count: 0 };
      cur.sum += r.overallRating; cur.count += 1;
      perDay.set(d, cur);
    }
    for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const trend = [...perDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, v]) => ({ day, avg: Math.round((v.sum / v.count) * 100) / 100, count: v.count }));
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8)
    .map(([tag, count]) => ({ tag, count }));
  const total = trend.reduce((s, d) => s + d.count, 0);
  const avg = total ? Math.round((trend.reduce((s, d) => s + d.avg * d.count, 0) / total) * 100) / 100 : null;
  return { days, trend, topTags, total, avg };
}
