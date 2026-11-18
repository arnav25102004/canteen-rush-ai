import { FeedbackStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { notifyUser } from './notification.service';
import type { AdminScope } from './feedbackAdmin.service';

export const CHANGELOG_MAX_LINKS = 20;
const CLOSED: FeedbackStatus[] = [FeedbackStatus.RESOLVED, FeedbackStatus.WONT_FIX, FeedbackStatus.DUPLICATE];

export interface PublishInput {
  title: string;
  body: string;
  canteenId?: string | null;
  linkedFeedbackIds: string[];
  markResolved?: boolean;
}

/**
 * Publish a "You said, we did" entry. Every linked feedback (and the canteen) must be inside the admin scope.
 * Authors are notified once each, anonymous ones too (the notification is addressed by id; the admin never
 * sees who). Linked feedback becomes RESOLVED only when `markResolved` is set.
 */
export async function publishChangelog(scope: AdminScope, actorId: string, input: PublishInput, now = new Date()) {
  const ids = [...new Set(input.linkedFeedbackIds)];
  if (ids.length > CHANGELOG_MAX_LINKS) throw new AppError(400, `Link at most ${CHANGELOG_MAX_LINKS} feedback items`);

  let institutionId: string | null = scope.institutionId ?? null;
  if (input.canteenId) {
    const canteen = await prisma.canteen.findFirst({
      where: { id: input.canteenId, ...(scope.institutionId ? { institutionId: scope.institutionId } : {}) },
      select: { id: true, institutionId: true },
    });
    if (!canteen) throw new AppError(404, 'Canteen not found');
    institutionId = canteen.institutionId ?? institutionId;
  }

  const linked = ids.length
    ? await prisma.feedback.findMany({
        where: { id: { in: ids }, deletedAt: null, ...scope },
        select: { id: true, userId: true, status: true, firstSeenAt: true },
      })
    : [];
  if (linked.length !== ids.length) throw new AppError(400, 'Some linked feedback was not found in your scope');

  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.changelogEntry.create({
      data: {
        institutionId, canteenId: input.canteenId ?? null, title: input.title, body: input.body,
        createdBy: actorId, publishedAt: now,
      },
    });
    if (ids.length) {
      await tx.feedback.updateMany({ where: { id: { in: ids }, ...scope }, data: { changelogEntryId: e.id } });
    }
    if (input.markResolved) {
      for (const fb of linked) {
        if (CLOSED.includes(fb.status)) continue;
        // Conditional on the status we read, so a concurrent change by another admin is not overwritten.
        const res = await tx.feedback.updateMany({
          where: { id: fb.id, ...scope, status: fb.status },
          data: { status: FeedbackStatus.RESOLVED, resolvedAt: now, firstSeenAt: fb.firstSeenAt ?? now },
        });
        if (res.count === 1) {
          await tx.feedbackEvent.create({
            data: {
              feedbackId: fb.id, actorId, type: 'status_changed', fromStatus: fb.status,
              toStatus: FeedbackStatus.RESOLVED, note: 'Published in You said, we did', isInternal: false,
            },
          });
        }
      }
    }
    return e;
  });

  // One notification per author, never blocking or failing the publish.
  const authors = [...new Set(linked.map((f) => f.userId).filter((u): u is string => !!u))];
  for (const userId of authors) {
    try {
      await notifyUser(userId, {
        title: 'You said, we did', body: input.title.slice(0, 120), type: 'feedback_changelog',
        data: { changelogId: entry.id },
      });
    } catch (err) {
      logger.warn('Changelog notification failed', { err: (err as Error)?.message });
    }
  }
  return { entry: toDto(entry), notified: authors.length };
}

function toDto(e: { id: string; title: string; body: string; canteenId: string | null; publishedAt: Date | null; createdAt: Date }) {
  return { id: e.id, title: e.title, body: e.body, canteenId: e.canteenId, publishedAt: e.publishedAt ?? e.createdAt };
}

/** Student view: published entries of the user's institution (and platform-wide ones), newest first. */
export async function listChangelog(institutionId: string | null | undefined, page: number, limit: number) {
  const where = {
    publishedAt: { not: null },
    OR: [{ institutionId: null }, ...(institutionId ? [{ institutionId }] : [])],
  };
  const [rows, total] = await Promise.all([
    prisma.changelogEntry.findMany({ where, orderBy: { publishedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.changelogEntry.count({ where }),
  ]);
  return { entries: rows.map(toDto), page, limit, total };
}

/** Admin list: entries inside the admin scope, with how many feedback items each links. */
export async function listChangelogAdmin(scope: AdminScope, page: number, limit: number) {
  const where = scope.institutionId ? { OR: [{ institutionId: scope.institutionId }, { institutionId: null }] } : {};
  const [rows, total] = await Promise.all([
    prisma.changelogEntry.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      include: { _count: { select: { feedbacks: true } } },
    }),
    prisma.changelogEntry.count({ where }),
  ]);
  return { entries: rows.map((e) => ({ ...toDto(e), linkedCount: e._count.feedbacks })), page, limit, total };
}
