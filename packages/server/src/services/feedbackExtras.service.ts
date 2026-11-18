import { AttachmentStatus, FeedbackKind, FeedbackModeration } from '@prisma/client';
import { prisma } from '../config/database';
import { cloudinaryConfigured, uploadBuffer, deleteAsset } from '../config/cloudinary';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { AdminScope } from './feedbackAdmin.service';

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/** Identify the image from its first bytes. The client's declared mime type is never trusted. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export interface UploadedFile { buffer: Buffer; size: number }

export async function addAttachment(userId: string, feedbackId: string, file: UploadedFile | undefined, kind: 'PHOTO' | 'SCREENSHOT' = 'PHOTO') {
  const fb = await prisma.feedback.findFirst({ where: { id: feedbackId, userId, deletedAt: null }, select: { id: true } });
  if (!fb) throw new AppError(404, 'Feedback not found');

  // Uploads are optional: with Cloudinary off, answer 200 so the app can hide its photo button.
  if (!cloudinaryConfigured) return { degraded: true as const, code: 'UPLOADS_UNAVAILABLE' as const };

  if (!file || !file.buffer?.length) throw new AppError(400, 'No image provided', 'NO_FILE');
  if (file.size > MAX_ATTACHMENT_BYTES || file.buffer.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, 'Image is too large (5 MB max)', 'TOO_LARGE');
  const mime = sniffImage(file.buffer);
  if (!mime || !ALLOWED_IMAGE_MIME.includes(mime)) throw new AppError(400, 'Only JPEG, PNG and WebP images are allowed', 'BAD_TYPE');

  const existing = await prisma.feedbackAttachment.count({ where: { feedbackId } });
  if (existing >= MAX_ATTACHMENTS) throw new AppError(409, `At most ${MAX_ATTACHMENTS} photos per feedback`, 'TOO_MANY');

  const up = await uploadBuffer(file.buffer, 'campus-khana/feedback');
  const row = await prisma.feedbackAttachment.create({
    data: { feedbackId, url: up.url, publicId: up.publicId, mimeType: mime, sizeBytes: file.buffer.length, kind, status: AttachmentStatus.PENDING },
  });
  return { degraded: false as const, attachment: { id: row.id, status: row.status, kind: row.kind } };
}

export async function decideAttachment(scope: AdminScope, attachmentId: string, actorId: string, decision: 'APPROVED' | 'REJECTED') {
  // Out of scope looks exactly like missing.
  const att = await prisma.feedbackAttachment.findFirst({
    where: { id: attachmentId, feedback: { deletedAt: null, ...scope } },
  });
  if (!att) throw new AppError(404, 'Attachment not found');
  if (att.status === decision) return { id: att.id, status: att.status };

  const status = decision === 'APPROVED' ? AttachmentStatus.APPROVED : AttachmentStatus.REJECTED;
  const changed = await prisma.$transaction(async (tx) => {
    const res = await tx.feedbackAttachment.updateMany({ where: { id: att.id, status: att.status }, data: { status } });
    if (res.count !== 1) return false;
    await tx.feedbackEvent.create({
      data: {
        feedbackId: att.feedbackId, actorId, type: decision === 'APPROVED' ? 'attachment_approved' : 'attachment_rejected',
        isInternal: true, data: { attachmentId: att.id },
      },
    });
    return true;
  });
  if (!changed) throw new AppError(409, 'This photo was changed by someone else. Reload and try again.', 'STALE_STATUS');
  if (status === AttachmentStatus.REJECTED && att.publicId) {
    const ok = await deleteAsset(att.publicId);
    if (!ok) logger.warn('Could not delete rejected feedback photo from Cloudinary', { attachmentId: att.id });
  }
  return { id: att.id, status };
}

// Idea board

const VOTABLE = { kind: FeedbackKind.APP_IDEA, deletedAt: null, moderation: { not: FeedbackModeration.HIDDEN } } as const;

async function loadVotable(institutionId: string | null | undefined, id: string) {
  const fb = await prisma.feedback.findFirst({
    where: { id, ...VOTABLE, institutionId: institutionId ?? '__none__' },
    select: { id: true, userId: true },
  });
  if (!fb) throw new AppError(404, 'Idea not found');
  return fb;
}

export async function voteIdea(userId: string, institutionId: string | null | undefined, id: string) {
  const fb = await loadVotable(institutionId, id);
  if (fb.userId === userId) throw new AppError(400, 'You cannot vote on your own idea', 'OWN_IDEA');
  const voteCount = await prisma.$transaction(async (tx) => {
    // ON CONFLICT DO NOTHING: a duplicate vote must not abort the transaction or bump the count.
    const inserted = await tx.$executeRaw`INSERT INTO feedback_idea_votes (feedback_id, user_id) VALUES (${id}, ${userId}) ON CONFLICT DO NOTHING`;
    if (inserted === 1) {
      const row = await tx.feedback.update({ where: { id }, data: { voteCount: { increment: 1 } }, select: { voteCount: true } });
      return row.voteCount;
    }
    const row = await tx.feedback.findUnique({ where: { id }, select: { voteCount: true } });
    return row?.voteCount ?? 0;
  });
  return { voted: true, voteCount };
}

export async function unvoteIdea(userId: string, institutionId: string | null | undefined, id: string) {
  await loadVotable(institutionId, id);
  const voteCount = await prisma.$transaction(async (tx) => {
    const del = await tx.feedbackIdeaVote.deleteMany({ where: { feedbackId: id, userId } });
    if (del.count === 1) {
      const row = await tx.feedback.update({ where: { id }, data: { voteCount: { decrement: 1 } }, select: { voteCount: true } });
      return row.voteCount;
    }
    const row = await tx.feedback.findUnique({ where: { id }, select: { voteCount: true } });
    return row?.voteCount ?? 0;
  });
  return { voted: false, voteCount };
}

function encodeIdeaCursor(votes: number, createdAt: Date, id: string) {
  return Buffer.from(`${votes}|${createdAt.toISOString()}|${id}`).toString('base64url');
}
function decodeIdeaCursor(c: string) {
  try {
    const [v, iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    const votes = Number(v);
    const createdAt = new Date(iso);
    if (!id || !Number.isInteger(votes) || Number.isNaN(createdAt.getTime())) throw new Error('bad');
    return { votes, createdAt, id };
  } catch {
    throw new AppError(400, 'Invalid cursor');
  }
}

/** Public idea DTO: the redacted text only. Never the author, order or identity fields. */
export function ideaDto(fb: any, userId: string) {
  return {
    id: fb.id,
    text: fb.bodyRedacted ?? '',
    voteCount: fb.voteCount,
    voted: (fb.votes?.length ?? 0) > 0,
    status: fb.status,
    mine: fb.userId === userId,
    createdAt: fb.createdAt,
  };
}

export async function listIdeas(userId: string, institutionId: string | null | undefined, limit: number, cursor?: string) {
  const and: any[] = [];
  if (cursor) {
    const c = decodeIdeaCursor(cursor);
    and.push({
      OR: [
        { voteCount: { lt: c.votes } },
        { voteCount: c.votes, createdAt: { lt: c.createdAt } },
        { voteCount: c.votes, createdAt: c.createdAt, id: { lt: c.id } },
      ],
    });
  }
  const rows = await prisma.feedback.findMany({
    where: { ...VOTABLE, institutionId: institutionId ?? '__none__', bodyRedacted: { not: null }, ...(and.length ? { AND: and } : {}) },
    orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, bodyRedacted: true, voteCount: true, status: true, createdAt: true, userId: true,
      votes: { where: { userId }, select: { userId: true }, take: 1 },
    },
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    ideas: page.map((r) => ideaDto(r, userId)),
    nextCursor: rows.length > limit && last ? encodeIdeaCursor(last.voteCount, last.createdAt, last.id) : null,
  };
}
