import { AppError } from '../utils/errors';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { istHour } from '../utils/helpers';
import { graphemeLength } from '../utils/feedbackSchemas';

const POINTS_PER_RUPEE = 0.1; // ₹10 = 1 point
const DOUBLE_POINTS_BEFORE_HOUR = 9; // before 9 AM

const REDEMPTION_TIERS = [
  { points: 200,  discount: 20  },
  { points: 500,  discount: 60  },
  { points: 1000, discount: 120 },
];

export function getRedemptionTiers() {
  return REDEMPTION_TIERS;
}

export async function validatePointsRedemption(
  userId: string,
  pointsToRedeem: number
): Promise<{ valid: boolean; discountAmount: number; error?: string }> {
  if (pointsToRedeem === 0) return { valid: true, discountAmount: 0 };

  const tier = REDEMPTION_TIERS.find((t) => t.points === pointsToRedeem);
  if (!tier) {
    return {
      valid: false,
      discountAmount: 0,
      error: `Points must be redeemed in exact tiers: ${REDEMPTION_TIERS.map((t) => t.points).join(', ')}`,
    };
  }

  const loyaltyAccount = await prisma.loyaltyAccount.findUnique({ where: { userId } });
  if (!loyaltyAccount || loyaltyAccount.totalPoints < pointsToRedeem) {
    return {
      valid: false,
      discountAmount: 0,
      error: `Insufficient points. You have ${loyaltyAccount?.totalPoints || 0} points, need ${pointsToRedeem}.`,
    };
  }

  return { valid: true, discountAmount: tier.discount };
}

/**
 * Spend points inside the caller's order transaction. The conditional update
 * makes concurrent orders unable to spend the same points twice.
 */
export async function redeemPoints(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  pointsToRedeem: number,
  discountAmount: number
): Promise<void> {
  const { count } = await tx.loyaltyAccount.updateMany({
    where: { userId, totalPoints: { gte: pointsToRedeem } },
    data: { totalPoints: { decrement: pointsToRedeem }, totalSaved: { increment: discountAmount } },
  });
  if (count === 0) throw new AppError(400, 'Not enough loyalty points');

  const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
  await tx.pointTransaction.create({
    data: {
      loyaltyId: account.id,
      orderId,
      type: 'REDEEMED',
      points: -pointsToRedeem,
      description: `Redeemed ${pointsToRedeem} points for ₹${discountAmount} discount`,
      balanceAfter: account.totalPoints,
    },
  });
}

/** Give back points spent on an order that was cancelled. */
export async function refundRedeemedPoints(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  points: number,
  discountAmount: number,
  orderNumber: string
): Promise<void> {
  const account = await tx.loyaltyAccount.findUnique({ where: { userId } });
  if (!account || points <= 0) return;
  const updated = await tx.loyaltyAccount.update({
    where: { id: account.id },
    data: { totalPoints: { increment: points }, totalSaved: { decrement: discountAmount } },
  });
  await tx.pointTransaction.create({
    data: {
      loyaltyId: account.id,
      orderId,
      type: 'BONUS',
      points,
      description: `Returned ${points} points for cancelled Order #${orderNumber}`,
      balanceAfter: updated.totalPoints,
    },
  });
}

export async function awardPointsForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: { include: { loyaltyAccount: true } } },
  });

  if (!order || order.status !== 'PICKED_UP') return;
  if (order.pointsRedeemed > 0) return; // don't award on redemption orders
  // Accounts are anonymised (not deleted) so userId/user survive — but a
  // deleted user's loyaltyAccount was removed on deletion; don't resurrect it.
  if (!order.userId || !order.user || order.user.isDeleted) return;
  const { userId, user } = order;

  const orderHour = istHour(order.createdAt);
  const isDoublePoints = orderHour < DOUBLE_POINTS_BEFORE_HOUR;
  const basePoints = Math.max(1, Math.floor(Number(order.subtotal) * POINTS_PER_RUPEE));
  const pointsToAward = isDoublePoints ? basePoints * 2 : basePoints;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  let loyaltyAccount = user.loyaltyAccount;
  if (!loyaltyAccount) {
    loyaltyAccount = await prisma.loyaltyAccount.create({
      data: { userId, totalPoints: 0, lifetimePoints: 0, totalSaved: 0 },
    });
  }

  const newBalance = loyaltyAccount.totalPoints + pointsToAward;

  await prisma.$transaction([
    prisma.loyaltyAccount.update({
      where: { id: loyaltyAccount.id },
      data: {
        totalPoints: { increment: pointsToAward },
        lifetimePoints: { increment: pointsToAward },
      },
    }),
    prisma.pointTransaction.create({
      data: {
        loyaltyId: loyaltyAccount.id,
        orderId: order.id,
        type: 'EARNED',
        points: pointsToAward,
        description: isDoublePoints
          ? `2× bonus: Earned ${pointsToAward} pts for Order #${order.orderNumber} (early bird!)`
          : `Earned ${pointsToAward} pts for Order #${order.orderNumber}`,
        balanceAfter: newBalance,
        expiresAt,
      },
    }),
    prisma.order.update({ where: { id: order.id }, data: { pointsEarned: pointsToAward } }),
  ]);
}

export async function getLoyaltyAccount(userId: string) {
  return prisma.loyaltyAccount.findUnique({
    where: { userId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Feedback points. Points are loyalty credit only; they never convert to cash.
// ---------------------------------------------------------------------------

export const FEEDBACK_POINTS = 10;
export const FEEDBACK_HELPFUL_POINTS = 10;
export const FEEDBACK_DAILY_CAP = 30;
export const FEEDBACK_MIN_ACCOUNT_AGE_MS = 24 * 3600 * 1000;
export const FEEDBACK_MIN_BODY_GRAPHEMES = 15;
const DAY_MS = 24 * 3600 * 1000;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

type PrismaLike = Prisma.TransactionClient | typeof prisma;

/** Absolute start of the IST calendar day containing `at`. */
export function istDayStartOf(at: Date): Date {
  return new Date(Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

/** Quality gate: at least one tag, or a body of 15+ characters. */
export function passesQualityGate(fb: { tags?: string[] | null; body?: string | null }): boolean {
  if ((fb.tags ?? []).length > 0) return true;
  return graphemeLength((fb.body ?? '').trim()) >= FEEDBACK_MIN_BODY_GRAPHEMES;
}

export type FeedbackAwardResult =
  | { awarded: true; points: number }
  | { awarded: false; reason: string };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Run `fn` in a transaction, or directly when the caller already passed one. */
async function inTx<T>(client: PrismaLike, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (typeof (client as any).$transaction === 'function') {
    return (client as typeof prisma).$transaction(fn);
  }
  return fn(client as Prisma.TransactionClient);
}

/**
 * Award 10 points for a quality order review. Idempotent: `PointTransaction.feedbackId` is unique, so a
 * duplicate award (retry, race) is a no-op, never an error. Rules: ORDER_REVIEW only, quality gate, one award
 * per order, account older than 24h, 30 points per user per IST day, not moderated (FLAGGED/HIDDEN) and
 * not edited (edits never earn). The daily-cap count runs inside the transaction under a per-user lock.
 */
export async function awardPointsForFeedback(
  client: PrismaLike,
  args: { userId: string; feedbackId: string; orderId: string },
  now: Date = new Date(),
): Promise<FeedbackAwardResult> {
  const { userId, feedbackId, orderId } = args;
  try {
    return await inTx(client, async (tx): Promise<FeedbackAwardResult> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const already = await tx.pointTransaction.findUnique({ where: { feedbackId }, select: { id: true } });
      if (already) return { awarded: false, reason: 'already_awarded' };

      const fb = await tx.feedback.findFirst({
        where: { id: feedbackId, userId, orderId, kind: 'ORDER_REVIEW', deletedAt: null },
        select: { tags: true, body: true, moderation: true, editCount: true },
      });
      if (!fb) return { awarded: false, reason: 'not_found' };
      if (fb.moderation === 'FLAGGED' || fb.moderation === 'HIDDEN') return { awarded: false, reason: 'moderated' };
      if (fb.editCount > 0) return { awarded: false, reason: 'edited' };
      if (!passesQualityGate(fb)) return { awarded: false, reason: 'low_quality' };

      const user = await tx.user.findUnique({
        where: { id: userId }, select: { createdAt: true, isDeleted: true, isBanned: true },
      });
      if (!user || user.isDeleted || user.isBanned) return { awarded: false, reason: 'account' };
      if (now.getTime() - user.createdAt.getTime() < FEEDBACK_MIN_ACCOUNT_AGE_MS) {
        return { awarded: false, reason: 'account_too_new' };
      }

      const account = await tx.loyaltyAccount.upsert({
        where: { userId }, create: { userId, totalPoints: 0, lifetimePoints: 0, totalSaved: 0 }, update: {},
      });

      // Once per order, even if the review was deleted and written again.
      const orderAward = await tx.pointTransaction.count({
        where: { loyaltyId: account.id, orderId, feedbackId: { not: null }, points: { gt: 0 } },
      });
      if (orderAward > 0) return { awarded: false, reason: 'order_already_awarded' };

      const today = await tx.pointTransaction.aggregate({
        where: { loyaltyId: account.id, feedbackId: { not: null }, points: { gt: 0 }, createdAt: { gte: istDayStartOf(now) } },
        _sum: { points: true },
      });
      if ((today._sum.points ?? 0) + FEEDBACK_POINTS > FEEDBACK_DAILY_CAP) {
        return { awarded: false, reason: 'daily_cap' };
      }

      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { totalPoints: { increment: FEEDBACK_POINTS }, lifetimePoints: { increment: FEEDBACK_POINTS } },
      });
      const fresh = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
      await tx.pointTransaction.create({
        data: {
          loyaltyId: account.id, orderId, feedbackId, type: 'BONUS', points: FEEDBACK_POINTS,
          description: `Thanks for your review: ${FEEDBACK_POINTS} pts`, balanceAfter: fresh.totalPoints,
          expiresAt: new Date(now.getTime() + 90 * DAY_MS),
        },
      });
      return { awarded: true, points: FEEDBACK_POINTS };
    });
  } catch (err) {
    // The unique column won a race against a concurrent identical award.
    if (isUniqueViolation(err)) return { awarded: false, reason: 'already_awarded' };
    throw err;
  }
}

/**
 * Admin marked a feedback "helpful": one extra 10 points, ever. Uses its own unique column
 * (`helpfulFeedbackId`) so it never collides with the review award on `feedbackId`. Not subject to the
 * daily cap or the quality gate: an admin chose it.
 */
export async function awardHelpfulBonus(
  client: PrismaLike,
  feedbackId: string,
  now: Date = new Date(),
): Promise<FeedbackAwardResult> {
  try {
    return await inTx(client, async (tx): Promise<FeedbackAwardResult> => {
      const fb = await tx.feedback.findFirst({
        where: { id: feedbackId, deletedAt: null }, select: { userId: true, moderation: true, orderId: true },
      });
      if (!fb || !fb.userId) return { awarded: false, reason: 'no_author' };
      if (fb.moderation === 'FLAGGED' || fb.moderation === 'HIDDEN') return { awarded: false, reason: 'moderated' };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fb.userId}))`;
      const dup = await tx.pointTransaction.findUnique({ where: { helpfulFeedbackId: feedbackId }, select: { id: true } });
      if (dup) return { awarded: false, reason: 'already_awarded' };

      const account = await tx.loyaltyAccount.upsert({
        where: { userId: fb.userId },
        create: { userId: fb.userId, totalPoints: 0, lifetimePoints: 0, totalSaved: 0 },
        update: {},
      });
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { totalPoints: { increment: FEEDBACK_HELPFUL_POINTS }, lifetimePoints: { increment: FEEDBACK_HELPFUL_POINTS } },
      });
      const fresh = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
      await tx.pointTransaction.create({
        data: {
          loyaltyId: account.id, orderId: fb.orderId, helpfulFeedbackId: feedbackId, type: 'BONUS',
          points: FEEDBACK_HELPFUL_POINTS,
          description: `Your feedback was marked helpful: ${FEEDBACK_HELPFUL_POINTS} pts`,
          balanceAfter: fresh.totalPoints, expiresAt: new Date(now.getTime() + 90 * DAY_MS),
        },
      });
      return { awarded: true, points: FEEDBACK_HELPFUL_POINTS };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { awarded: false, reason: 'already_awarded' };
    throw err;
  }
}

/**
 * Take back the points a review earned (for example when it is hidden as spam). Writes a negative BONUS row
 * and never lets the balance go below 0: if the user already spent the points, only what is left is removed.
 * Idempotent through a marker in the reversal row's description. Not wired to moderation yet.
 */
export async function reverseFeedbackPoints(
  feedbackId: string,
  client: PrismaLike = prisma,
): Promise<{ reversed: number }> {
  return inTx(client, async (tx) => {
    const awards = { OR: [{ feedbackId }, { helpfulFeedbackId: feedbackId }], points: { gt: 0 } };
    const first = await tx.pointTransaction.findFirst({ where: awards, select: { loyaltyId: true } });
    if (!first) return { reversed: 0 };
    const total = await tx.pointTransaction.aggregate({ where: awards, _sum: { points: true } });
    const marker = `[reversal:${feedbackId}]`;
    const done = await tx.pointTransaction.findFirst({
      where: { loyaltyId: first.loyaltyId, description: { contains: marker } }, select: { id: true },
    });
    if (done) return { reversed: 0 };

    const wanted = total._sum.points ?? 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const acct = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: first.loyaltyId } });
      const amount = Math.min(wanted, acct.totalPoints);
      if (amount <= 0) return { reversed: 0 };
      // Conditional on the balance we read: a concurrent spend makes this match nothing and we re-read.
      const res = await tx.loyaltyAccount.updateMany({
        where: { id: acct.id, totalPoints: { gte: amount } },
        data: { totalPoints: { decrement: amount } },
      });
      if (res.count !== 1) continue;
      await tx.pointTransaction.create({
        data: {
          loyaltyId: acct.id, type: 'BONUS', points: -amount,
          description: `Review points removed ${marker}`, balanceAfter: acct.totalPoints - amount,
        },
      });
      return { reversed: amount };
    }
    return { reversed: 0 };
  });
}

/** IST week number (Monday start) for an instant. Consecutive weeks differ by exactly 1. */
export function istWeekIndex(at: Date): number {
  const dayNum = Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS); // 0 = Thu 1 Jan 1970
  return Math.floor((dayNum + 3) / 7);
}

/** Current and best run of consecutive IST weeks that contain a qualifying review. */
export function computeStreak(dates: Date[], now: Date = new Date()): { current: number; best: number } {
  const weeks = [...new Set(dates.map(istWeekIndex))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < weeks.length; i++) {
    run = i > 0 && weeks[i] === weeks[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  // A streak is still alive if the latest review was this week or last week.
  const thisWeek = istWeekIndex(now);
  const last = weeks[weeks.length - 1];
  let current = 0;
  if (last !== undefined && last >= thisWeek - 1) {
    current = 1;
    for (let i = weeks.length - 1; i > 0 && weeks[i] === weeks[i - 1] + 1; i--) current++;
  }
  return { current, best };
}

/** Streak plus today's points and what is left of the daily cap. No extra table: it is a query. */
export async function getFeedbackStreak(userId: string, now: Date = new Date()) {
  const rows = await prisma.feedback.findMany({
    where: { userId, kind: 'ORDER_REVIEW', deletedAt: null, moderation: { notIn: ['FLAGGED', 'HIDDEN'] } },
    select: { createdAt: true, tags: true, body: true },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });
  const { current, best } = computeStreak(rows.filter(passesQualityGate).map((r) => r.createdAt), now);

  const account = await prisma.loyaltyAccount.findUnique({ where: { userId }, select: { id: true } });
  let earnedToday = 0;
  if (account) {
    const agg = await prisma.pointTransaction.aggregate({
      where: { loyaltyId: account.id, feedbackId: { not: null }, points: { gt: 0 }, createdAt: { gte: istDayStartOf(now) } },
      _sum: { points: true },
    });
    earnedToday = agg._sum.points ?? 0;
  }
  return {
    currentStreakWeeks: current,
    bestStreakWeeks: best,
    pointsEarnedToday: earnedToday,
    dailyCapRemaining: Math.max(0, FEEDBACK_DAILY_CAP - earnedToday),
  };
}
