import { OrderStatus, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { notifyUser } from './notification.service';
import { logger } from '../utils/logger';
import { inQuietHours } from '../utils/feedbackNudge';

const HOUR = 3600 * 1000;
const BATCH = 200;
const REVIEW_WINDOW_MS = 7 * 24 * HOUR;
const REVIEWERS = [UserRole.STUDENT, UserRole.FACULTY];

const userOk = { isDeleted: false, isBanned: false, role: { in: REVIEWERS } };

/**
 * Claims the first nudge of an order. Only one runner gets count 1, so the push is sent once even
 * if two instances overlap.
 */
export async function claimFirstNudge(orderId: string, now: Date): Promise<boolean> {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: OrderStatus.PICKED_UP, feedbackNudgeSentAt: null },
    data: { feedbackNudgeSentAt: now },
  });
  return count === 1;
}

/** Claims the softer 24h follow-up. */
export async function claimSecondNudge(orderId: string, now: Date): Promise<boolean> {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: OrderStatus.PICKED_UP, feedbackNudgeSentAt: { not: null }, feedbackNudge2SentAt: null },
    data: { feedbackNudge2SentAt: now },
  });
  return count === 1;
}

async function nudgedRecently(userId: string, exceptOrderId: string, since: Date): Promise<boolean> {
  const other = await prisma.order.findFirst({
    where: {
      userId, id: { not: exceptOrderId },
      OR: [{ feedbackNudgeSentAt: { gte: since } }, { feedbackNudge2SentAt: { gte: since } }],
    },
    select: { id: true },
  });
  return !!other;
}

async function send(userId: string, orderId: string, soft: boolean) {
  await notifyUser(userId, {
    title: soft ? 'Still thinking about your order?' : 'How was your order?',
    body: soft ? 'A quick tap helps the canteen get better.' : 'Rate it in under 10 seconds.',
    type: 'feedback_nudge',
    data: { orderId, url: `campuskhana://feedback/order/${orderId}` },
  });
}

/**
 * One tick of the nudge job. Returns how many nudges were sent. A user gets at most one nudge per
 * 24h; the in-app notification is always written, push is best effort inside notifyUser.
 */
export async function runFeedbackNudges(now = new Date()): Promise<number> {
  const day = new Date(now.getTime() - 24 * HOUR);
  const windowStart = new Date(now.getTime() - REVIEW_WINDOW_MS);
  const nudgedThisRun = new Set<string>();
  let sent = 0;

  const first = await prisma.order.findMany({
    where: {
      status: OrderStatus.PICKED_UP,
      feedbackNudgeAt: { lte: now },
      feedbackNudgeSentAt: null,
      pickedUpAt: { gte: windowStart },
      feedbacks: { none: { kind: 'ORDER_REVIEW', deletedAt: null } },
      user: userOk,
    },
    select: { id: true, userId: true },
    orderBy: { feedbackNudgeAt: 'asc' },
    take: BATCH,
  });
  for (const o of first) {
    if (!o.userId || nudgedThisRun.has(o.userId)) continue;
    if (await nudgedRecently(o.userId, o.id, day)) continue;
    if (!(await claimFirstNudge(o.id, now))) continue;
    nudgedThisRun.add(o.userId);
    try { await send(o.userId, o.id, false); sent++; } catch (err) {
      logger.warn('Feedback nudge failed', { err: (err as Error)?.message });
    }
  }

  // Softer follow-up 24h after the first, only while still unreviewed and not in quiet hours.
  if (!inQuietHours(now)) {
    const second = await prisma.order.findMany({
      where: {
        status: OrderStatus.PICKED_UP,
        feedbackNudgeSentAt: { not: null, lte: day },
        feedbackNudge2SentAt: null,
        pickedUpAt: { gte: windowStart },
        feedbacks: { none: { kind: 'ORDER_REVIEW', deletedAt: null } },
        user: userOk,
      },
      select: { id: true, userId: true },
      orderBy: { feedbackNudgeSentAt: 'asc' },
      take: BATCH,
    });
    for (const o of second) {
      if (!o.userId || nudgedThisRun.has(o.userId)) continue;
      if (await nudgedRecently(o.userId, o.id, day)) continue;
      if (!(await claimSecondNudge(o.id, now))) continue;
      nudgedThisRun.add(o.userId);
      try { await send(o.userId, o.id, true); sent++; } catch (err) {
        logger.warn('Feedback nudge failed', { err: (err as Error)?.message });
      }
    }
  }
  return sent;
}
