import { Prisma, OrderStatus, UserRole, FeedbackKind, FeedbackModeration, FeedbackPriority, FeedbackVisibility } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { CreateAppFeedbackInput, CreateOrderReviewInput, UpdateFeedbackInput } from '../utils/feedbackSchemas';
import { moderateText } from './feedbackModeration.service';
import { applyCanteenDelta, applyItemDelta } from './feedbackAggregates.service';
import { slaDueAt } from '../utils/feedbackSla';
import { awardPointsForFeedback } from './loyalty.service';
import { logger } from '../utils/logger';

export const REVIEW_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const EDIT_WINDOW_MS = 24 * 3600 * 1000;
export const MAX_EDITS = 3;
export const MAX_FEEDBACK_PER_30_DAYS = 50;
export const MAX_APP_FEEDBACK_PER_DAY = 3;
export const APP_MIN_ACCOUNT_AGE_MS = 24 * 3600 * 1000;
export const PAYMENT_SUPPORT_HINT =
  'For payment problems, please also contact Campus Khana support so we can check your transaction.';

/** Events the author may see; internal notes are filtered out in the query as well as in studentView. */
const PUBLIC_EVENTS = { where: { isInternal: false }, orderBy: { createdAt: 'asc' as const } };

const REVIEWER_ROLES: UserRole[] = [UserRole.STUDENT, UserRole.FACULTY];

type Tx = Prisma.TransactionClient;

/** What the author may see. Moderation state and the redacted copy are deliberately left out. */
export function studentView(fb: any, ratings?: any[]) {
  return {
    id: fb.id,
    kind: fb.kind,
    status: fb.status,
    orderId: fb.orderId,
    canteenId: fb.canteenId,
    overallRating: fb.overallRating,
    tags: fb.tags,
    body: fb.body,
    isAnonymous: fb.isAnonymous,
    shareNameWithCanteen: fb.shareNameWithCanteen,
    editCount: fb.editCount,
    editedAt: fb.editedAt,
    createdAt: fb.createdAt,
    editDeadline: fb.createdAt ? new Date(new Date(fb.createdAt).getTime() + EDIT_WINDOW_MS) : null,
    items: (ratings ?? fb.ratings ?? []).map((r: any) => ({
      menuItemId: r.menuItemId, rating: r.rating, taste: r.taste, portion: r.portion, value: r.value, tags: r.tags,
    })),
    // Only what the author may read: status changes and public replies. No actor, no notes, no reasons.
    timeline: (fb.events ?? [])
      .filter((e: any) => !e.isInternal && (e.type === 'status_changed' || e.type === 'reply' || e.type === 'REPLY_PUBLIC'))
      .map((e: any) => {
        const isReply = e.type === 'reply' || e.type === 'REPLY_PUBLIC';
        return {
          type: isReply ? 'reply' : e.type, toStatus: e.toStatus ?? null, reply: isReply ? e.note : null,
          from: e.type === 'REPLY_PUBLIC' ? 'canteen' : undefined, createdAt: e.createdAt,
        };
      }),
  };
}

async function loadReviewer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isBanned: true, isDeleted: true, institutionId: true },
  });
  if (!user || user.isDeleted) throw new AppError(404, 'Not found');
  if (user.isBanned) throw new AppError(403, 'Your account cannot post feedback', 'ACCOUNT_RESTRICTED');
  if (!REVIEWER_ROLES.includes(user.role)) throw new AppError(403, 'Only students and faculty can review orders', 'ROLE_NOT_ALLOWED');
  return user;
}

/** Order the caller owns. 404 (never 403) when it is someone else's or missing. */
async function loadOwnOrder(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: {
      id: true, status: true, pickedUpAt: true, canteenId: true,
      items: { select: { menuItemId: true, menuItem: { select: { name: true } } } },
    },
  });
  if (!order) throw new AppError(404, 'Order not found');
  return order;
}

type OrderRow = Awaited<ReturnType<typeof loadOwnOrder>>;

/** Why an order cannot be reviewed right now, or null if it can. */
export function ineligibleReason(
  order: Pick<OrderRow, 'status' | 'pickedUpAt'>,
  now: Date,
): { status: number; code: string; message: string } | null {
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.NO_SHOW) {
    return {
      status: 409, code: 'ORDER_NOT_REVIEWABLE',
      message: 'This order was not picked up. Share feedback about the canteen or the app instead.',
    };
  }
  if (order.status !== OrderStatus.PICKED_UP || !order.pickedUpAt) {
    return { status: 409, code: 'ORDER_NOT_PICKED_UP', message: 'You can review an order after you pick it up.' };
  }
  if (now.getTime() - order.pickedUpAt.getTime() > REVIEW_WINDOW_MS) {
    return { status: 410, code: 'REVIEW_WINDOW_CLOSED', message: 'The 7-day review window for this order has closed.' };
  }
  return null;
}

export async function getEligibility(userId: string, orderId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true, isBanned: true, isDeleted: true },
  });
  const order = await loadOwnOrder(userId, orderId);
  const items = order.items.map((i) => ({ menuItemId: i.menuItemId, name: i.menuItem?.name }));
  const base = { items };

  if (!user || user.isDeleted || user.isBanned || !REVIEWER_ROLES.includes(user.role)) {
    return { eligible: false, reason: 'Your account cannot review orders.', ...base };
  }
  const bad = ineligibleReason(order, now);
  if (bad) return { eligible: false, reason: bad.message, ...base };

  const existing = await prisma.feedback.findFirst({
    where: { orderId, userId, kind: FeedbackKind.ORDER_REVIEW, deletedAt: null },
    select: { id: true, createdAt: true },
  });
  if (existing) {
    return {
      eligible: false, reason: 'You already reviewed this order.', existingFeedbackId: existing.id,
      editDeadline: new Date(existing.createdAt.getTime() + EDIT_WINDOW_MS), ...base,
    };
  }
  return { eligible: true, ...base };
}

function assertItemsBelong(input: { items?: { menuItemId: string }[] }, order: OrderRow) {
  const allowed = new Set(order.items.map((i) => i.menuItemId));
  const seen = new Set<string>();
  for (const it of input.items ?? []) {
    if (seen.has(it.menuItemId)) throw new AppError(400, 'Each item can be rated once', 'DUPLICATE_ITEM');
    seen.add(it.menuItemId);
    if (!allowed.has(it.menuItemId)) throw new AppError(400, 'Item is not part of this order', 'ITEM_NOT_IN_ORDER');
  }
}

function moderationFields(body: string | null | undefined) {
  const m = moderateText(body);
  return {
    moderation: m.flagged ? FeedbackModeration.FLAGGED : FeedbackModeration.CLEAN,
    bodyRedacted: body ? m.redacted : null,
  };
}

/**
 * Points for a new review, after its transaction committed. Errors are logged and swallowed: a points
 * problem must never fail the review. Returns the points awarded (0 if none) so the app can say so.
 */
async function awardAfterCreate(userId: string, feedbackId: string, orderId: string, now: Date): Promise<number> {
  try {
    const res = await awardPointsForFeedback(prisma, { userId, feedbackId, orderId }, now);
    return res.awarded ? res.points : 0;
  } catch (err) {
    logger.warn('Feedback points award failed', { feedbackId, err: (err as Error)?.message });
    return 0;
  }
}

export async function createOrderReview(
  userId: string,
  input: CreateOrderReviewInput,
  now = new Date(),
): Promise<{ feedback: any; created: boolean }> {
  const user = await loadReviewer(userId);
  const order = await loadOwnOrder(userId, input.orderId);

  // A retry of an earlier success must still succeed after the window closes.
  const prior = await prisma.feedback.findUnique({
    where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
    include: { ratings: true },
  });
  if (prior) return { feedback: studentView(prior), created: false };

  const bad = ineligibleReason(order, now);
  if (bad) throw new AppError(bad.status, bad.message, bad.code);
  assertItemsBelong(input, order);

  try {
    const out = await prisma.$transaction(async (tx) => {
      // Serialise one user's writes so the 30-day cap and duplicate checks cannot race.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const again = await tx.feedback.findUnique({
        where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
        include: { ratings: true },
      });
      if (again) return { feedback: studentView(again), created: false };

      const dup = await tx.feedback.findFirst({
        where: { orderId: order.id, kind: FeedbackKind.ORDER_REVIEW, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw new AppError(409, 'You already reviewed this order', 'ALREADY_REVIEWED', { feedbackId: dup.id });

      const recent = await tx.feedback.count({
        where: { userId, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3600 * 1000) } },
      });
      if (recent >= MAX_FEEDBACK_PER_30_DAYS) {
        throw new AppError(429, 'Feedback limit reached. Try again later.', 'FEEDBACK_CAP');
      }

      const fb = await tx.feedback.create({
        data: {
          kind: FeedbackKind.ORDER_REVIEW,
          visibility: FeedbackVisibility.VENDOR,
          userId,
          institutionId: user.institutionId,
          orderId: order.id,
          canteenId: order.canteenId,
          overallRating: input.overallRating,
          tags: input.tags ?? [],
          body: input.body || null,
          isAnonymous: input.isAnonymous ?? false,
          shareNameWithCanteen: input.shareNameWithCanteen ?? false,
          clientRequestId: input.clientRequestId,
          slaDueAt: slaDueAt(FeedbackPriority.NORMAL, now),
          ...moderationFields(input.body),
        },
      });

      const items = input.items ?? [];
      if (items.length) {
        await tx.rating.createMany({
          data: items.map((i) => ({
            userId, orderId: order.id, menuItemId: i.menuItemId, canteenId: order.canteenId, feedbackId: fb.id,
            rating: i.rating, taste: i.taste ?? null, portion: i.portion ?? null, value: i.value ?? null, tags: i.tags ?? [],
          })),
        });
        for (const i of items) await applyItemDelta(tx, i.menuItemId, i.rating, 1);
      }
      await applyCanteenDelta(tx, order.canteenId, input.overallRating, 1);

      const ratings = await tx.rating.findMany({ where: { feedbackId: fb.id } });
      return { feedback: studentView(fb, ratings), created: true };
    });
    if (!out.created) return out;
    const pointsAwarded = await awardAfterCreate(userId, out.feedback.id, order.id, now);
    return { feedback: { ...out.feedback, pointsAwarded }, created: true };
  } catch (err) {
    // A concurrent identical request can win the unique index between our check and insert.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.feedback.findUnique({
        where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
        include: { ratings: true },
      });
      if (existing) return { feedback: studentView(existing), created: false };
      const dup = await prisma.feedback.findFirst({
        where: { orderId: order.id, kind: FeedbackKind.ORDER_REVIEW, deletedAt: null }, select: { id: true },
      });
      if (dup) throw new AppError(409, 'You already reviewed this order', 'ALREADY_REVIEWED', { feedbackId: dup.id });
    }
    throw err;
  }
}

/** Priority an app bug gets from its severity. Payment problems are the most urgent. */
export function appPriority(kind: FeedbackKind, severity?: string | null): FeedbackPriority {
  if (kind !== FeedbackKind.APP_BUG) return FeedbackPriority.NORMAL;
  if (severity === 'PAYMENT_ISSUE') return FeedbackPriority.URGENT;
  if (severity === 'BLOCKS_ME') return FeedbackPriority.HIGH;
  return FeedbackPriority.NORMAL;
}

function appResponse(fb: any, severity?: string | null) {
  return {
    ...studentView(fb),
    supportHint: severity === 'PAYMENT_ISSUE' ? PAYMENT_SUPPORT_HINT : undefined,
  };
}

const APP_KIND_LIST: FeedbackKind[] = [
  FeedbackKind.APP_BUG, FeedbackKind.APP_IDEA, FeedbackKind.APP_PRAISE, FeedbackKind.APP_OTHER,
];

/** App feedback (bug, idea, praise, other). Open to every logged-in role. */
export async function createAppFeedback(
  userId: string,
  input: CreateAppFeedbackInput,
  now = new Date(),
): Promise<{ feedback: any; created: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isBanned: true, isDeleted: true, institutionId: true, createdAt: true },
  });
  if (!user || user.isDeleted) throw new AppError(404, 'Not found');
  if (user.isBanned) throw new AppError(403, 'Your account cannot post feedback', 'ACCOUNT_RESTRICTED');

  const sev = input.severity ?? null;
  const prior = await prisma.feedback.findUnique({
    where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
  });
  if (prior) return { feedback: appResponse(prior, sev), created: false };

  if (now.getTime() - user.createdAt.getTime() < APP_MIN_ACCOUNT_AGE_MS) {
    throw new AppError(403, 'New accounts can send app feedback after 24 hours.', 'ACCOUNT_TOO_NEW');
  }

  const priority = appPriority(input.kind as FeedbackKind, sev);
  const context = input.contextJson || sev ? { ...(input.contextJson ?? {}), ...(sev ? { severity: sev } : {}) } : undefined;
  const tags = [...(input.tags ?? [])];
  if (sev === 'PAYMENT_ISSUE' && !tags.includes('payment')) tags.push('payment');

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const again = await tx.feedback.findUnique({
        where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
      });
      if (again) return { feedback: appResponse(again, sev), created: false };

      const dayCount = await tx.feedback.count({
        where: { userId, kind: { in: APP_KIND_LIST }, createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } },
      });
      if (dayCount >= MAX_APP_FEEDBACK_PER_DAY) {
        throw new AppError(429, 'You can send 3 app feedbacks a day. Try again tomorrow.', 'APP_FEEDBACK_DAILY_CAP');
      }
      const recent = await tx.feedback.count({
        where: { userId, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3600 * 1000) } },
      });
      if (recent >= MAX_FEEDBACK_PER_30_DAYS) {
        throw new AppError(429, 'Feedback limit reached. Try again later.', 'FEEDBACK_CAP');
      }

      const fb = await tx.feedback.create({
        data: {
          kind: input.kind as FeedbackKind,
          visibility: FeedbackVisibility.ADMIN_ONLY,
          priority,
          userId,
          institutionId: user.institutionId,
          tags,
          body: input.body || null,
          isAnonymous: input.isAnonymous ?? false,
          contextJson: context as Prisma.InputJsonValue | undefined,
          clientRequestId: input.clientRequestId,
          slaDueAt: slaDueAt(priority, now),
          ...moderationFields(input.body),
        },
      });
      return { feedback: appResponse(fb, sev), created: true };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.feedback.findUnique({
        where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } },
      });
      if (existing) return { feedback: appResponse(existing, sev), created: false };
    }
    throw err;
  }
}

export async function updateOrderReview(userId: string, id: string, input: UpdateFeedbackInput, now = new Date()) {
  await loadReviewer(userId);
  const fb = await prisma.feedback.findFirst({
    where: { id, userId, kind: FeedbackKind.ORDER_REVIEW, deletedAt: null },
    include: { ratings: true },
  });
  if (!fb || !fb.orderId || !fb.canteenId) throw new AppError(404, 'Feedback not found');
  if (now.getTime() - fb.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new AppError(403, 'Reviews can only be edited within 24 hours', 'EDIT_WINDOW_CLOSED');
  }
  if (fb.editCount >= MAX_EDITS) throw new AppError(403, 'Edit limit reached', 'EDIT_LIMIT');
  // A hidden review is out of the aggregates; editing it would re-add deltas and reset its moderation.
  if (fb.moderation === FeedbackModeration.HIDDEN) throw new AppError(403, 'This review can no longer be edited', 'REVIEW_HIDDEN');

  const orderId = fb.orderId;
  const canteenId = fb.canteenId;
  const order = await loadOwnOrder(userId, orderId);
  assertItemsBelong(input, order);

  return prisma.$transaction(async (tx) => {
    const data: Prisma.FeedbackUpdateManyMutationInput = { editedAt: now, editCount: { increment: 1 } };
    if (input.overallRating !== undefined) data.overallRating = input.overallRating;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.body !== undefined) {
      data.body = input.body || null;
      Object.assign(data, moderationFields(input.body));
    }
    // Guarded on the values we read, so two concurrent edits cannot both apply their difference.
    const res = await tx.feedback.updateMany({
      where: { id, userId, deletedAt: null, editCount: fb.editCount, overallRating: fb.overallRating },
      data,
    });
    if (res.count !== 1) throw new AppError(409, 'Review changed, please retry', 'EDIT_CONFLICT');

    if (input.overallRating !== undefined && fb.overallRating != null && input.overallRating !== fb.overallRating) {
      await applyCanteenDelta(tx, canteenId, input.overallRating - fb.overallRating, 0);
    }

    for (const it of input.items ?? []) {
      const old = fb.ratings.find((r) => r.menuItemId === it.menuItemId);
      if (old) {
        const r = await tx.rating.updateMany({
          where: { id: old.id, rating: old.rating },
          data: {
            rating: it.rating, taste: it.taste ?? old.taste, portion: it.portion ?? old.portion,
            value: it.value ?? old.value, tags: it.tags ?? old.tags,
          },
        });
        if (r.count !== 1) throw new AppError(409, 'Review changed, please retry', 'EDIT_CONFLICT');
        await applyItemDelta(tx, it.menuItemId, it.rating - old.rating, 0);
      } else {
        await tx.rating.create({
          data: {
            userId, orderId, menuItemId: it.menuItemId, canteenId, feedbackId: id,
            rating: it.rating, taste: it.taste ?? null, portion: it.portion ?? null, value: it.value ?? null, tags: it.tags ?? [],
          },
        });
        await applyItemDelta(tx, it.menuItemId, it.rating, 1);
      }
    }

    const updated = await tx.feedback.findUniqueOrThrow({ where: { id }, include: { ratings: true } });
    return studentView(updated);
  });
}

export async function deleteOrderReview(userId: string, id: string, now = new Date()) {
  await prisma.$transaction(async (tx) => {
    const res = await tx.feedback.updateMany({
      where: { id, userId, kind: FeedbackKind.ORDER_REVIEW, deletedAt: null },
      data: { deletedAt: now },
    });
    if (res.count !== 1) throw new AppError(404, 'Feedback not found');

    const fb = await tx.feedback.findUniqueOrThrow({ where: { id }, include: { ratings: true } });
    // A hidden review already left the aggregates when it was hidden: do not subtract it twice.
    if (fb.moderation !== FeedbackModeration.HIDDEN) {
      for (const r of fb.ratings) await applyItemDelta(tx, r.menuItemId, -r.rating, -1);
      if (fb.canteenId && fb.overallRating != null) await applyCanteenDelta(tx, fb.canteenId, -fb.overallRating, -1);
    }
    // Drop the per-item rows so the order can be reviewed again (unique on user, order, item).
    await tx.rating.deleteMany({ where: { feedbackId: id } });
  });
}

export async function listMine(userId: string, page: number, limit: number) {
  const where = { userId, deletedAt: null };
  const [rows, total] = await Promise.all([
    prisma.feedback.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { ratings: true, events: PUBLIC_EVENTS },
    }),
    prisma.feedback.count({ where }),
  ]);
  return { feedback: rows.map((r) => studentView(r)), page, limit, total };
}

export async function getMine(userId: string, id: string) {
  const fb = await prisma.feedback.findFirst({ where: { id, userId, deletedAt: null }, include: { ratings: true, events: PUBLIC_EVENTS } });
  if (!fb) throw new AppError(404, 'Feedback not found');
  return studentView(fb);
}

/**
 * Account deletion: keep the numbers (so aggregates stay correct) but sever the link to the
 * person and drop everything free-form.
 */
export async function anonymiseUserFeedback(tx: Tx, userId: string) {
  await tx.feedback.updateMany({
    where: { userId },
    data: {
      userId: null, isAnonymous: true, shareNameWithCanteen: false,
      body: null, bodyRedacted: null, contextJson: Prisma.DbNull,
    },
  });
  await tx.rating.updateMany({ where: { userId }, data: { userId: null } });
}
