import { Prisma, FeedbackKind, FeedbackPriority, FeedbackStatus, FeedbackModeration, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { cleanText, FEEDBACK_TAGS, graphemeLength } from '../utils/feedbackSchemas';
import { slaDueAt } from '../utils/feedbackSla';
import { notifyUser } from './notification.service';
import { awardHelpfulBonus, FEEDBACK_HELPFUL_POINTS } from './loyalty.service';

/** What feedbackScope(req) returns for an admin. Spread last into every where so a filter can never widen it. */
export type AdminScope = { institutionId?: string; canteenId?: string };

export const CLOSED: FeedbackStatus[] = [FeedbackStatus.RESOLVED, FeedbackStatus.WONT_FIX, FeedbackStatus.DUPLICATE];
const OPEN: FeedbackStatus[] = [FeedbackStatus.RECEIVED, FeedbackStatus.SEEN, FeedbackStatus.IN_PROGRESS];
const REASON_REQUIRED: FeedbackStatus[] = [FeedbackStatus.WONT_FIX, FeedbackStatus.DUPLICATE];
export const NOTE_MAX = 2000;
export const REPLY_MAX = 1000;

export interface ListFilters {
  kind?: FeedbackKind;
  canteenId?: string;
  minRating?: number;
  maxRating?: number;
  status?: FeedbackStatus[];
  priority?: FeedbackPriority;
  tag?: string;
  from?: string; // IST calendar date YYYY-MM-DD
  to?: string;
  hasPhoto?: boolean;
  anonymous?: boolean;
  flagged?: boolean;
  assignee?: string; // user id
  needsAttention?: boolean;
  limit: number;
  cursor?: string;
}

/** Start of an IST calendar day as an absolute instant. */
export function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}
export function decodeCursor(c: string): { createdAt: Date; id: string } {
  try {
    const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) throw new Error('bad');
    return { createdAt, id };
  } catch {
    throw new AppError(400, 'Invalid cursor');
  }
}

export function buildListWhere(scope: AdminScope, f: ListFilters): Prisma.FeedbackWhereInput {
  const and: Prisma.FeedbackWhereInput[] = [];
  const where: Prisma.FeedbackWhereInput = { deletedAt: null };

  if (f.kind) where.kind = f.kind;
  if (f.canteenId) where.canteenId = f.canteenId;
  if (f.minRating != null || f.maxRating != null) {
    where.overallRating = { ...(f.minRating != null ? { gte: f.minRating } : {}), ...(f.maxRating != null ? { lte: f.maxRating } : {}) };
  }
  if (f.status?.length) where.status = { in: f.status };
  if (f.priority) where.priority = f.priority;
  if (f.tag) where.tags = { has: f.tag };
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: istDayStart(f.from) } : {}),
      // inclusive end date: strictly before the next IST day
      ...(f.to ? { lt: new Date(istDayStart(f.to).getTime() + 24 * 3600 * 1000) } : {}),
    };
  }
  if (f.hasPhoto != null) where.attachments = f.hasPhoto ? { some: {} } : { none: {} };
  if (f.anonymous != null) where.isAnonymous = f.anonymous;
  if (f.flagged) where.moderation = FeedbackModeration.FLAGGED;
  if (f.assignee) where.assignedTo = f.assignee;
  if (f.needsAttention) {
    and.push({ status: { in: OPEN } });
    and.push({
      OR: [
        { priority: { in: [FeedbackPriority.HIGH, FeedbackPriority.URGENT] } },
        { overallRating: { lte: 2 } },
        { moderation: FeedbackModeration.FLAGGED },
      ],
    });
  }
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    and.push({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] });
  }
  if (and.length) where.AND = and;
  // Scope last: a client-supplied canteenId can narrow the scope but never replace it.
  return { ...where, ...scope };
}

export function snippet(body: string | null): string | null {
  if (!body) return null;
  const s = body.replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export async function listFeedback(scope: AdminScope, f: ListFilters) {
  const where = buildListWhere(scope, f);
  const rows = await prisma.feedback.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    select: {
      id: true, kind: true, status: true, priority: true, moderation: true, overallRating: true, tags: true,
      body: true, isAnonymous: true, assignedTo: true, createdAt: true, slaDueAt: true,
      canteen: { select: { id: true, name: true } },
      _count: { select: { attachments: true } },
    },
  });
  const page = rows.slice(0, f.limit);
  const nextCursor = rows.length > f.limit ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null;

  const assigneeIds = [...new Set(page.map((r) => r.assignedTo).filter((x): x is string => !!x))];
  const assignees = assigneeIds.length
    ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(assignees.map((a) => [a.id, a.name]));

  return {
    feedback: page.map((r) => ({
      id: r.id, kind: r.kind, status: r.status, priority: r.priority, flagged: r.moderation === FeedbackModeration.FLAGGED,
      overallRating: r.overallRating, tags: r.tags, snippet: snippet(r.body), isAnonymous: r.isAnonymous,
      canteen: r.canteen, assignedTo: r.assignedTo, assigneeName: r.assignedTo ? names.get(r.assignedTo) ?? null : null,
      createdAt: r.createdAt, slaDueAt: r.slaDueAt, photoCount: r._count.attachments,
    })),
    nextCursor,
  };
}

async function loadScoped(scope: AdminScope, id: string) {
  const fb = await prisma.feedback.findFirst({ where: { id, deletedAt: null, ...scope } });
  // Out of scope looks exactly like missing.
  if (!fb) throw new AppError(404, 'Feedback not found');
  return fb;
}

/** Notifications must never break or roll back an admin action that already committed. */
async function tryNotify(userId: string | null, payload: Parameters<typeof notifyUser>[1]) {
  if (!userId) return;
  try {
    await notifyUser(userId, payload);
  } catch (err) {
    logger.warn('Feedback notification failed', { err: (err as Error)?.message });
  }
}

const STATUS_COPY: Partial<Record<FeedbackStatus, string>> = {
  SEEN: 'The team has seen your feedback.',
  IN_PROGRESS: 'We are working on your feedback.',
  RESOLVED: 'Your feedback has been resolved. Thank you!',
  WONT_FIX: 'We reviewed your feedback and will not act on it right now.',
  DUPLICATE: 'Your feedback matches one we already have. Thank you!',
};

export async function notifyStatus(fb: { id: string; userId: string | null }, to: FeedbackStatus) {
  const body = STATUS_COPY[to];
  if (!body) return;
  await tryNotify(fb.userId, {
    title: 'Update on your feedback', body, type: 'feedback_update', data: { feedbackId: fb.id, status: to },
  });
}

/** Admin detail. Opening a RECEIVED item marks it SEEN (conditionally, so two admins only flip it once). */
export async function getFeedbackDetail(scope: AdminScope, id: string, actorId: string, now = new Date()) {
  let fb = await loadScoped(scope, id);
  let seenNow = false;

  if (fb.status === FeedbackStatus.RECEIVED) {
    seenNow = await prisma.$transaction(async (tx) => {
      const res = await tx.feedback.updateMany({
        where: { id, ...scope, status: FeedbackStatus.RECEIVED },
        data: { status: FeedbackStatus.SEEN, firstSeenAt: fb.firstSeenAt ?? now },
      });
      if (res.count !== 1) return false;
      await tx.feedbackEvent.create({
        data: {
          feedbackId: id, actorId, type: 'status_changed', fromStatus: FeedbackStatus.RECEIVED,
          toStatus: FeedbackStatus.SEEN, note: 'Opened', isInternal: false,
        },
      });
      return true;
    });
    if (seenNow) {
      await notifyStatus(fb, FeedbackStatus.SEEN);
      fb = await loadScoped(scope, id);
    } else {
      fb = await loadScoped(scope, id); // someone else won the race
    }
  }

  const [events, ratings, attachments, user, assignee, canteen] = await Promise.all([
    prisma.feedbackEvent.findMany({ where: { feedbackId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.rating.findMany({ where: { feedbackId: id }, include: { menuItem: { select: { name: true } } } }),
    prisma.feedbackAttachment.findMany({ where: { feedbackId: id }, orderBy: { createdAt: 'asc' } }),
    // Identity is looked up only for non-anonymous feedback. Reveal for anonymous is a separate, audited step.
    !fb.isAnonymous && fb.userId
      ? prisma.user.findUnique({ where: { id: fb.userId }, select: { id: true, name: true, email: true } })
      : Promise.resolve(null),
    fb.assignedTo ? prisma.user.findUnique({ where: { id: fb.assignedTo }, select: { id: true, name: true } }) : Promise.resolve(null),
    fb.canteenId ? prisma.canteen.findUnique({ where: { id: fb.canteenId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);

  return {
    feedback: {
      id: fb.id, kind: fb.kind, status: fb.status, priority: fb.priority, moderation: fb.moderation,
      overallRating: fb.overallRating, tags: fb.tags, body: fb.body, isAnonymous: fb.isAnonymous,
      orderId: fb.orderId, canteen, assignee, duplicateOfId: fb.duplicateOfId,
      contextJson: fb.contextJson, firstSeenAt: fb.firstSeenAt, slaDueAt: fb.slaDueAt, resolvedAt: fb.resolvedAt,
      editedAt: fb.editedAt, createdAt: fb.createdAt,
      // Never present for anonymous feedback, whatever the caller's role.
      author: fb.isAnonymous ? null : user,
      items: ratings.map((r) => ({
        menuItemId: r.menuItemId, name: r.menuItem?.name ?? null, rating: r.rating, taste: r.taste, portion: r.portion, value: r.value, tags: r.tags,
      })),
      attachments: attachments.map((a) => ({ id: a.id, url: a.url, status: a.status })),
      timeline: events.map((e) => ({
        id: e.id, type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, isInternal: e.isInternal,
        data: e.data, actorId: e.actorId, createdAt: e.createdAt,
      })),
    },
  };
}

export interface UpdateInput {
  status?: FeedbackStatus;
  expectedStatus?: FeedbackStatus;
  priority?: FeedbackPriority;
  assignedTo?: string | null;
  reason?: string;
  duplicateOfId?: string | null;
  /** Mark helpful: one extra 10 points to the author, once ever. */
  helpful?: boolean;
}

export async function updateFeedback(scope: AdminScope, id: string, actorId: string, input: UpdateInput, now = new Date()) {
  const fb = await loadScoped(scope, id);

  if (input.expectedStatus && input.expectedStatus !== fb.status) {
    throw new AppError(409, 'This item was changed by someone else. Reload and try again.', 'STALE_STATUS', { currentStatus: fb.status });
  }
  const reason = input.reason ? cleanText(input.reason) : '';
  if (input.status) {
    if (input.status === fb.status) throw new AppError(400, 'Already in that status');
    if (REASON_REQUIRED.includes(input.status) && graphemeLength(reason) < 3) {
      throw new AppError(400, 'A reason is required for this status', 'REASON_REQUIRED');
    }
  }
  if (input.assignedTo) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: input.assignedTo,
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        ...(scope.institutionId ? { institutionId: scope.institutionId } : {}),
      },
      select: { id: true },
    });
    if (!assignee) throw new AppError(400, 'Assignee must be an admin of this institution');
  }
  if (input.duplicateOfId) {
    if (input.duplicateOfId === id) throw new AppError(400, 'An item cannot duplicate itself');
    const target = await prisma.feedback.findFirst({ where: { id: input.duplicateOfId, deletedAt: null, ...scope }, select: { id: true } });
    if (!target) throw new AppError(400, 'Duplicate target not found');
  }

  const data: Prisma.FeedbackUncheckedUpdateManyInput = {};
  const events: Prisma.FeedbackEventCreateManyInput[] = [];

  if (input.status) {
    data.status = input.status;
    if (!fb.firstSeenAt) data.firstSeenAt = now;
    data.resolvedAt = CLOSED.includes(input.status) ? now : null;
    if (input.status === FeedbackStatus.DUPLICATE) data.duplicateOfId = input.duplicateOfId ?? null;
    events.push({
      feedbackId: id, actorId, type: 'status_changed', fromStatus: fb.status, toStatus: input.status,
      note: reason || null, isInternal: false,
    });
  }
  if (input.priority && input.priority !== fb.priority) {
    data.priority = input.priority;
    if (!CLOSED.includes(input.status ?? fb.status)) data.slaDueAt = slaDueAt(input.priority, fb.createdAt);
    events.push({
      feedbackId: id, actorId, type: 'priority_changed', isInternal: true, data: { from: fb.priority, to: input.priority },
    });
  }
  if (input.assignedTo !== undefined && input.assignedTo !== fb.assignedTo) {
    data.assignedTo = input.assignedTo;
    events.push({
      feedbackId: id, actorId, type: 'assigned', isInternal: true, data: { from: fb.assignedTo, to: input.assignedTo },
    });
  }
  if (!events.length && !input.helpful) throw new AppError(400, 'Nothing to change');

  if (events.length) await prisma.$transaction(async (tx) => {
    // Conditional on the status we read: a concurrent change makes this match nothing.
    const res = await tx.feedback.updateMany({
      where: { id, ...scope, deletedAt: null, status: fb.status },
      data,
    });
    if (res.count !== 1) {
      throw new AppError(409, 'This item was changed by someone else. Reload and try again.', 'STALE_STATUS');
    }
    await tx.feedbackEvent.createMany({ data: events });
  });

  if (input.status) await notifyStatus(fb, input.status);

  let helpfulAwarded = false;
  if (input.helpful) {
    try {
      const res = await awardHelpfulBonus(prisma, id, now);
      helpfulAwarded = res.awarded;
      if (res.awarded) {
        await prisma.feedbackEvent.create({
          data: { feedbackId: id, actorId, type: 'marked_helpful', isInternal: true, data: { points: FEEDBACK_HELPFUL_POINTS } },
        });
        await tryNotify(fb.userId, {
          title: 'Your feedback was helpful',
          body: `The team marked your feedback helpful. +${FEEDBACK_HELPFUL_POINTS} points.`,
          type: 'feedback_update', data: { feedbackId: fb.id, helpful: true },
        });
      }
    } catch (err) {
      logger.warn('Helpful bonus failed', { feedbackId: id, err: (err as Error)?.message });
    }
  }
  const detail = await getFeedbackDetail(scope, id, actorId, now);
  return input.helpful ? { ...detail, helpfulAwarded } : detail;
}

export async function addNote(scope: AdminScope, id: string, actorId: string, text: string) {
  await loadScoped(scope, id);
  const note = cleanText(text);
  if (!note) throw new AppError(400, 'Note is empty');
  if (graphemeLength(note) > NOTE_MAX) throw new AppError(400, `Max ${NOTE_MAX} characters`);
  const ev = await prisma.feedbackEvent.create({
    data: { feedbackId: id, actorId, type: 'note', note, isInternal: true },
  });
  return { event: { id: ev.id, type: ev.type, note: ev.note, isInternal: true, createdAt: ev.createdAt } };
}

export async function addReply(scope: AdminScope, id: string, actorId: string, text: string) {
  const fb = await loadScoped(scope, id);
  const note = cleanText(text);
  if (!note) throw new AppError(400, 'Reply is empty');
  if (graphemeLength(note) > REPLY_MAX) throw new AppError(400, `Max ${REPLY_MAX} characters`);
  const ev = await prisma.feedbackEvent.create({
    data: { feedbackId: id, actorId, type: 'reply', note, isInternal: false },
  });
  // Anonymous feedback still reaches its author: the notification is addressed by id, never revealed to the admin.
  await tryNotify(fb.userId, {
    title: 'The team replied to your feedback',
    body: note.length > 140 ? `${note.slice(0, 140)}…` : note,
    type: 'feedback_update',
    data: { feedbackId: fb.id, reply: true },
  });
  return { event: { id: ev.id, type: ev.type, note: ev.note, isInternal: false, createdAt: ev.createdAt } };
}

export async function feedbackStats(scope: AdminScope, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const base: Prisma.FeedbackWhereInput = { deletedAt: null, ...scope };
  const recent: Prisma.FeedbackWhereInput = { ...base, createdAt: { gte: since } };

  const [byStatus, byKind, avg, tagRows] = await Promise.all([
    prisma.feedback.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.feedback.groupBy({ by: ['kind'], where: recent, _count: { _all: true } }),
    prisma.feedback.aggregate({ where: { ...recent, overallRating: { not: null } }, _avg: { overallRating: true }, _count: { overallRating: true } }),
    prisma.feedback.findMany({ where: recent, select: { tags: true }, take: 5000 }),
  ]);

  const tagCounts = new Map<string, number>();
  for (const r of tagRows) for (const t of r.tags) if (FEEDBACK_TAGS.includes(t)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count }));

  const status: Record<string, number> = {};
  for (const s of Object.values(FeedbackStatus)) status[s] = 0;
  for (const r of byStatus) status[r.status] = r._count._all;
  const kind: Record<string, number> = {};
  for (const r of byKind) kind[r.kind] = r._count._all;

  return {
    days, byStatus: status, byKind: kind,
    averageRating: avg._avg.overallRating != null ? Math.round(avg._avg.overallRating * 100) / 100 : null,
    ratedCount: avg._count.overallRating,
    topTags,
  };
}
