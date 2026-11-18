import { FeedbackStatus, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { notifyUser } from './notification.service';
import { logger } from '../utils/logger';

export const SLA_BREACH_EVENT = 'SLA_BREACH';
const OPEN: FeedbackStatus[] = [FeedbackStatus.RECEIVED, FeedbackStatus.SEEN, FeedbackStatus.IN_PROGRESS];
const BATCH = 200;

/** The assignee, or every admin of the feedback's institution (super admins if there is none). */
async function recipients(fb: { assignedTo: string | null; institutionId: string | null }): Promise<string[]> {
  if (fb.assignedTo) return [fb.assignedTo];
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, institutionId: fb.institutionId, isDeleted: false },
    select: { id: true },
  });
  if (admins.length) return admins.map((a) => a.id);
  const supers = await prisma.user.findMany({ where: { role: UserRole.SUPER_ADMIN, isDeleted: false }, select: { id: true } });
  return supers.map((a) => a.id);
}

/**
 * Notifies once per breached item. The SLA_BREACH event is the dedupe record: it is written
 * (internal, so the author and vendors never see it) under the same transaction lock that checks
 * for it, before anyone is notified.
 */
export async function runSlaBreaches(now = new Date()): Promise<number> {
  const due = await prisma.feedback.findMany({
    where: {
      deletedAt: null,
      status: { in: OPEN },
      slaDueAt: { lte: now },
      events: { none: { type: SLA_BREACH_EVENT } },
    },
    select: { id: true, kind: true, priority: true, assignedTo: true, institutionId: true },
    orderBy: { slaDueAt: 'asc' },
    take: BATCH,
  });

  let notified = 0;
  for (const fb of due) {
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sla:' + fb.id}))`;
      const exists = await tx.feedbackEvent.findFirst({ where: { feedbackId: fb.id, type: SLA_BREACH_EVENT }, select: { id: true } });
      if (exists) return false;
      await tx.feedbackEvent.create({
        data: { feedbackId: fb.id, type: SLA_BREACH_EVENT, isInternal: true, data: { priority: fb.priority } },
      });
      return true;
    });
    if (!claimed) continue;
    try {
      for (const userId of await recipients(fb)) {
        await notifyUser(userId, {
          title: 'Feedback is past its response time',
          body: `A ${fb.priority.toLowerCase()} priority ${fb.kind.replace('_', ' ').toLowerCase()} has not been handled in time.`,
          type: 'feedback_sla_breach',
          data: { feedbackId: fb.id },
        });
      }
      notified++;
    } catch (err) {
      logger.warn('SLA breach notification failed', { err: (err as Error)?.message });
    }
  }
  return notified;
}
