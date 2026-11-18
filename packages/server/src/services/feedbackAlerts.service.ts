import { FeedbackKind, FeedbackModeration, FeedbackPriority, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { notifyUser } from './notification.service';
import { logger } from '../utils/logger';

const DAY = 24 * 3600 * 1000;
export const VELOCITY_EVENT = 'VELOCITY_ALERT';
export const VELOCITY_MIN = 3;
export const VELOCITY_MULTIPLE = 5;

/**
 * Review-bombing check. `oneStar24h` counts 1-star reviews in the last 24h (including the new
 * one); `oneStarPrior30d` counts them in the 30 days before that. Fires on 3 or more in a day, or
 * on 2 or more that are at least 5x the daily mean of the prior 30 days.
 */
export function velocityVerdict(oneStar24h: number, oneStarPrior30d: number): boolean {
  if (oneStar24h >= VELOCITY_MIN) return true;
  const dailyMean = oneStarPrior30d / 30;
  return oneStar24h >= 2 && oneStar24h >= VELOCITY_MULTIPLE * dailyMean;
}

async function institutionAdmins(institutionId: string | null): Promise<string[]> {
  if (!institutionId) return [];
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, institutionId, isDeleted: false, isBanned: false },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

async function alertAdmins(institutionId: string | null, title: string, body: string, data: Record<string, string | number | boolean | null>) {
  for (const id of await institutionAdmins(institutionId)) {
    try {
      await notifyUser(id, { title, body, type: 'feedback_alert', data });
    } catch (err) {
      logger.warn('Feedback alert failed', { err: (err as Error)?.message });
    }
  }
}

/**
 * Called fire-and-forget after a feedback row is created. Never throws into the caller.
 * Alerts: a 1-star review with text, an URGENT app bug, and 3+ one-star reviews for one canteen in
 * 24h (once per canteen per 24h). The velocity check also flags the recent 1-star rows.
 */
export async function runFeedbackAlerts(feedbackId: string, now = new Date()): Promise<void> {
  try {
    const fb = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true, kind: true, priority: true, overallRating: true, body: true, canteenId: true, institutionId: true },
    });
    if (!fb) return;

    if (fb.kind === FeedbackKind.ORDER_REVIEW && fb.overallRating === 1 && fb.body) {
      await alertAdmins(fb.institutionId, '1-star review with a comment', 'A student left a 1-star review with a comment.', { feedbackId: fb.id });
    }
    if (fb.kind === FeedbackKind.APP_BUG && fb.priority === FeedbackPriority.URGENT) {
      await alertAdmins(fb.institutionId, 'Urgent app bug reported', 'An urgent app bug needs attention.', { feedbackId: fb.id });
    }
    if (fb.kind === FeedbackKind.ORDER_REVIEW && fb.overallRating === 1 && fb.canteenId) {
      await checkCanteenVelocity(fb.id, fb.canteenId, fb.institutionId, now);
    }
  } catch (err) {
    logger.warn('Feedback alerts failed', { err: (err as Error)?.message });
  }
}

export async function checkCanteenVelocity(
  feedbackId: string, canteenId: string, institutionId: string | null, now = new Date(),
): Promise<boolean> {
  const since24h = new Date(now.getTime() - DAY);
  const since30d = new Date(now.getTime() - 31 * DAY);
  const base = { canteenId, kind: FeedbackKind.ORDER_REVIEW, overallRating: 1, deletedAt: null };
  const [last24h, prior] = await Promise.all([
    prisma.feedback.count({ where: { ...base, createdAt: { gte: since24h } } }),
    prisma.feedback.count({ where: { ...base, createdAt: { gte: since30d, lt: since24h } } }),
  ]);
  if (!velocityVerdict(last24h, prior)) return false;

  // Hold the rows back from the mood score until an admin has looked at them.
  await prisma.feedback.updateMany({
    where: { ...base, createdAt: { gte: since24h }, moderation: { in: [FeedbackModeration.CLEAN, FeedbackModeration.PENDING] } },
    data: { moderation: FeedbackModeration.FLAGGED },
  });

  // One alert per canteen per 24h. The check and the marker event share a lock.
  const first = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'fbvel:' + canteenId}))`;
    const seen = await tx.feedbackEvent.findFirst({
      where: { type: VELOCITY_EVENT, createdAt: { gte: since24h }, data: { path: ['canteenId'], equals: canteenId } },
      select: { id: true },
    });
    if (seen) return false;
    await tx.feedbackEvent.create({
      data: { feedbackId, type: VELOCITY_EVENT, isInternal: true, data: { canteenId, count: last24h } },
    });
    return true;
  });
  if (!first) return true;

  await alertAdmins(institutionId, 'Several 1-star reviews for one canteen', `${last24h} one-star reviews in the last 24 hours. They are held back from the mood score until reviewed.`, { canteenId, feedbackId });
  return true;
}
