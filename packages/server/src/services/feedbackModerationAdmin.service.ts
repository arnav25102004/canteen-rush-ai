import { Prisma, FeedbackKind, FeedbackModeration, FeedbackPriority, FeedbackStatus, UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { cleanText, graphemeLength } from '../utils/feedbackSchemas';
import { slaDueAt } from '../utils/feedbackSla';
import { applyCanteenDelta, applyItemDelta } from './feedbackAggregates.service';
import { AdminScope, CLOSED, notifyStatus, snippet } from './feedbackAdmin.service';

type Tx = Prisma.TransactionClient;

export type ModerateAction = 'HIDE' | 'FLAG' | 'CLEAR';
export type BulkAction = 'SET_STATUS' | 'ASSIGN' | 'SET_PRIORITY' | 'HIDE';
export interface BulkResult { id: string; ok: boolean; error?: string }

const TARGET: Record<ModerateAction, FeedbackModeration> = {
  HIDE: FeedbackModeration.HIDDEN,
  FLAG: FeedbackModeration.FLAGGED,
  CLEAR: FeedbackModeration.CLEAN,
};

/**
 * Hook for F8 (points). Called once after a HIDE commits. Intentionally a no-op for now: the
 * points reversal for a hidden review ("points are reversed if the review is hidden as spam")
 * lands with the points feature. It must never throw.
 */
export async function onFeedbackHidden(_feedbackId: string): Promise<void> {
  /* no-op until F8 */
}

interface ModRow {
  id: string;
  kind: FeedbackKind;
  canteenId: string | null;
  overallRating: number | null;
  moderation: FeedbackModeration;
}

interface BulkRow extends ModRow {
  status: FeedbackStatus;
  priority: FeedbackPriority;
  assignedTo: string | null;
  userId: string | null;
  createdAt: Date;
  firstSeenAt: Date | null;
}

/** sign -1 removes the review's contribution to MenuItem/Canteen aggregates, +1 re-adds it. */
async function adjustAggregates(tx: Tx, fb: ModRow, sign: 1 | -1) {
  if (fb.kind !== FeedbackKind.ORDER_REVIEW) return;
  const ratings = await tx.rating.findMany({ where: { feedbackId: fb.id }, select: { menuItemId: true, rating: true } });
  for (const r of ratings) await applyItemDelta(tx, r.menuItemId, sign * r.rating, sign);
  if (fb.canteenId && fb.overallRating != null) await applyCanteenDelta(tx, fb.canteenId, sign * fb.overallRating, sign);
}

/**
 * Move one feedback row to a new moderation state inside the caller's transaction.
 * The update is conditional on the moderation value we read, so the aggregate adjustment is
 * applied exactly once: a concurrent hide matches nothing and fails with 409 instead of
 * subtracting the review a second time. Returns false when it was already in that state.
 */
export async function applyModeration(
  tx: Tx, scope: AdminScope, fb: ModRow, to: FeedbackModeration, actorId: string, reason: string, now = new Date(),
): Promise<boolean> {
  if (fb.moderation === to) return false;
  const res = await tx.feedback.updateMany({
    where: { id: fb.id, ...scope, deletedAt: null, moderation: fb.moderation },
    data: { moderation: to },
  });
  if (res.count !== 1) throw new AppError(409, 'This item was changed by someone else. Reload and try again.', 'STALE_MODERATION');

  if (to === FeedbackModeration.HIDDEN) await adjustAggregates(tx, fb, -1);
  else if (fb.moderation === FeedbackModeration.HIDDEN) await adjustAggregates(tx, fb, 1);

  await tx.feedbackEvent.create({
    data: {
      feedbackId: fb.id, actorId, type: 'moderated', note: reason, isInternal: true,
      data: { from: fb.moderation, to },
    },
  });
  if (to === FeedbackModeration.HIDDEN || to === FeedbackModeration.CLEAN) {
    await tx.feedbackReport.updateMany({ where: { feedbackId: fb.id, resolvedAt: null }, data: { resolvedAt: now } });
  }
  return true;
}

const MOD_SELECT = { id: true, kind: true, canteenId: true, overallRating: true, moderation: true } as const;

export async function moderateFeedback(
  scope: AdminScope, id: string, actorId: string, action: ModerateAction, reasonIn: string, now = new Date(),
) {
  const reason = cleanText(reasonIn);
  if (graphemeLength(reason) < 3) throw new AppError(400, 'A reason is required', 'REASON_REQUIRED');
  const fb = await prisma.feedback.findFirst({ where: { id, deletedAt: null, ...scope }, select: MOD_SELECT });
  if (!fb) throw new AppError(404, 'Feedback not found'); // out of scope looks like missing
  const to = TARGET[action];
  const changed = await prisma.$transaction((tx) => applyModeration(tx, scope, fb, to, actorId, reason, now));
  if (changed && to === FeedbackModeration.HIDDEN) await onFeedbackHidden(id);
  return { feedback: { id, moderation: changed ? to : fb.moderation }, changed };
}

export async function listReports(scope: AdminScope, limit = 100) {
  const rows = await prisma.feedbackReport.findMany({
    where: { resolvedAt: null, feedback: { deletedAt: null, ...scope } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
    select: {
      id: true, reason: true, createdAt: true,
      feedback: {
        select: {
          id: true, kind: true, status: true, moderation: true, overallRating: true, body: true, isAnonymous: true,
          canteen: { select: { id: true, name: true } },
        },
      },
    },
  });
  // The reporter is deliberately not returned: reports are about content, not people.
  return {
    reports: rows.map((r) => ({
      id: r.id, reason: r.reason, createdAt: r.createdAt,
      feedback: {
        id: r.feedback.id, kind: r.feedback.kind, status: r.feedback.status, moderation: r.feedback.moderation,
        overallRating: r.feedback.overallRating, snippet: snippet(r.feedback.body), isAnonymous: r.feedback.isAnonymous,
        canteen: r.feedback.canteen,
      },
    })),
  };
}

/** A user reports the vendor reply / changelog entry on feedback they can see (their own). */
export async function reportFeedback(userId: string, id: string, reasonIn: string) {
  const reason = cleanText(reasonIn);
  const len = graphemeLength(reason);
  if (len < 3 || len > 300) throw new AppError(400, 'Reason must be 3 to 300 characters');
  const fb = await prisma.feedback.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  if (!fb) throw new AppError(404, 'Feedback not found');
  try {
    await prisma.feedbackReport.create({ data: { feedbackId: id, reporterId: userId, reason } });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') throw new AppError(409, 'You already reported this', 'ALREADY_REPORTED');
    throw err;
  }
  return { success: true };
}

export interface BulkInput {
  ids: string[];
  action: BulkAction;
  value?: string | null;
  reason?: string;
}

export async function bulkUpdate(scope: AdminScope, actorId: string, input: BulkInput, now = new Date()) {
  const ids = [...new Set(input.ids)];
  const reason = input.reason ? cleanText(input.reason) : '';
  let status: FeedbackStatus | undefined;
  let priority: FeedbackPriority | undefined;
  let assignee: string | null = null;

  switch (input.action) {
    case 'SET_STATUS':
      if (!input.value || !(input.value in FeedbackStatus)) throw new AppError(400, 'Invalid status');
      status = input.value as FeedbackStatus;
      if (status === FeedbackStatus.DUPLICATE) throw new AppError(400, 'Mark duplicates one at a time');
      if (status === FeedbackStatus.WONT_FIX && graphemeLength(reason) < 3) {
        throw new AppError(400, 'A reason is required for this status', 'REASON_REQUIRED');
      }
      break;
    case 'SET_PRIORITY':
      if (!input.value || !(input.value in FeedbackPriority)) throw new AppError(400, 'Invalid priority');
      priority = input.value as FeedbackPriority;
      break;
    case 'ASSIGN':
      assignee = input.value ?? null;
      if (assignee) {
        const ok = await prisma.user.findFirst({
          where: {
            id: assignee, role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
            ...(scope.institutionId ? { institutionId: scope.institutionId } : {}),
          },
          select: { id: true },
        });
        if (!ok) throw new AppError(400, 'Assignee must be an admin of this institution');
      }
      break;
    case 'HIDE':
      if (graphemeLength(reason) < 3) throw new AppError(400, 'A reason is required', 'REASON_REQUIRED');
      break;
    default:
      throw new AppError(400, 'Invalid action');
  }

  const results: BulkResult[] = [];
  const statusChanged: { id: string; userId: string | null; to: FeedbackStatus }[] = [];
  const hidden: string[] = [];
  const stale = () => new AppError(409, 'Changed by someone else', 'STALE');

  async function applyRow(tx: Tx, row: BulkRow): Promise<boolean> {
    if (input.action === 'HIDE') {
      const done = await applyModeration(tx, scope, row, FeedbackModeration.HIDDEN, actorId, reason, now);
      if (done) hidden.push(row.id);
      return done;
    }
    if (input.action === 'SET_STATUS' && status) {
      if (row.status === status) return false;
      const res = await tx.feedback.updateMany({
        where: { id: row.id, ...scope, deletedAt: null, status: row.status },
        data: { status, firstSeenAt: row.firstSeenAt ?? now, resolvedAt: CLOSED.includes(status) ? now : null },
      });
      if (res.count !== 1) throw stale();
      await tx.feedbackEvent.create({
        data: {
          feedbackId: row.id, actorId, type: 'status_changed', fromStatus: row.status, toStatus: status,
          note: reason || null, isInternal: false,
        },
      });
      statusChanged.push({ id: row.id, userId: row.userId, to: status });
      return true;
    }
    if (input.action === 'SET_PRIORITY' && priority) {
      if (row.priority === priority) return false;
      const res = await tx.feedback.updateMany({
        where: { id: row.id, ...scope, deletedAt: null, priority: row.priority },
        data: { priority, ...(CLOSED.includes(row.status) ? {} : { slaDueAt: slaDueAt(priority, row.createdAt) }) },
      });
      if (res.count !== 1) throw stale();
      await tx.feedbackEvent.create({
        data: { feedbackId: row.id, actorId, type: 'priority_changed', isInternal: true, data: { from: row.priority, to: priority } },
      });
      return true;
    }
    if (input.action === 'ASSIGN') {
      if (row.assignedTo === assignee) return false;
      const res = await tx.feedback.updateMany({
        where: { id: row.id, ...scope, deletedAt: null, assignedTo: row.assignedTo },
        data: { assignedTo: assignee },
      });
      if (res.count !== 1) throw stale();
      await tx.feedbackEvent.create({
        data: { feedbackId: row.id, actorId, type: 'assigned', isInternal: true, data: { from: row.assignedTo, to: assignee } },
      });
      return true;
    }
    return false;
  }

  await prisma.$transaction(async (tx) => {
    const rows = await tx.feedback.findMany({
      where: { id: { in: ids }, deletedAt: null, ...scope },
      select: {
        ...MOD_SELECT, status: true, priority: true, assignedTo: true, userId: true, createdAt: true, firstSeenAt: true,
      },
    });
    const byId = new Map<string, BulkRow>(rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = byId.get(id);
      // Outside the caller's scope is reported exactly like a missing row.
      if (!row) { results.push({ id, ok: false, error: 'Not found' }); continue; }
      try {
        results.push((await applyRow(tx, row)) ? { id, ok: true } : { id, ok: false, error: 'Already in that state' });
      } catch (err) {
        if (err instanceof AppError) results.push({ id, ok: false, error: err.message });
        else throw err;
      }
    }
  }, { timeout: 30_000, maxWait: 5_000 });

  // After commit: notifications and the F8 hook must never undo the applied changes.
  for (const c of statusChanged) await notifyStatus({ id: c.id, userId: c.userId }, c.to);
  for (const id of hidden) await onFeedbackHidden(id);

  return {
    results,
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
