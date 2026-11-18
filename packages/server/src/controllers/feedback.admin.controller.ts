import { Response } from 'express';
import { z } from 'zod';
import { FeedbackKind, FeedbackPriority, FeedbackStatus } from '@prisma/client';
import { AuthRequest, feedbackScope } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { decideAttachment } from '../services/feedbackExtras.service';
import { UserRole } from '@prisma/client';
import { logger } from '../utils/logger';
import { feedbackDashboard } from '../services/feedbackDashboard.service';
import { bulkUpdate, listReports, moderateFeedback } from '../services/feedbackModerationAdmin.service';
import { exportChunks, exportFilename, finishExportAudit, startExportAudit } from '../services/feedbackExport.service';
import { addNote, addReply, feedbackStats, getFeedbackDetail, listFeedback, updateFeedback } from '../services/feedbackAdmin.service';

const idSchema = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const listQuery = z.object({
  kind: z.nativeEnum(FeedbackKind).optional(),
  canteenId: z.string().uuid().optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  maxRating: z.coerce.number().int().min(1).max(5).optional(),
  // comma-separated list: status=RECEIVED,SEEN
  status: z.string().optional().transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(z.nativeEnum(FeedbackStatus)).max(6).optional()),
  priority: z.nativeEnum(FeedbackPriority).optional(),
  tag: z.string().max(40).optional(),
  from: day.optional(),
  to: day.optional(),
  hasPhoto: bool.optional(),
  anonymous: bool.optional(),
  flagged: bool.optional(),
  needsAttention: bool.optional(),
  assignee: z.string().max(40).optional(), // a user id, or 'me'
  sort: z.enum(['recent', 'votes']).default('recent'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

const updateBody = z.object({
  status: z.nativeEnum(FeedbackStatus).optional(),
  expectedStatus: z.nativeEnum(FeedbackStatus).optional(),
  priority: z.nativeEnum(FeedbackPriority).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  duplicateOfId: z.string().uuid().nullable().optional(),
  reason: z.string().max(500).optional(),
  helpful: z.boolean().optional(),
}).refine((b) => !b.status || !!b.expectedStatus, { message: 'expectedStatus is required with status', path: ['expectedStatus'] });

const textBody = z.object({ text: z.string().min(1).max(5000) });

function scopeOr403(req: AuthRequest) {
  const scope = feedbackScope(req);
  if (!scope) throw new AppError(403, 'Forbidden: no feedback scope');
  return scope;
}

function uuidParam(v: unknown): string {
  const r = idSchema.safeParse(v);
  if (!r.success) throw new AppError(404, 'Not found');
  return r.data;
}

export async function list(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const q = listQuery.parse(req.query);
  const { assignee, ...rest } = q;
  const assigneeId = assignee === 'me' ? req.user!.id : assignee;
  if (assigneeId && !idSchema.safeParse(assigneeId).success) throw new AppError(400, 'Invalid assignee');
  return res.json(await listFeedback(scope, { ...rest, assignee: assigneeId }));
}

export async function stats(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const days = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.days);
  return res.json(await feedbackStats(scope, days));
}

export async function detail(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  return res.json(await getFeedbackDetail(scope, uuidParam(req.params.id), req.user!.id));
}

export async function patch(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const body = updateBody.parse(req.body);
  return res.json(await updateFeedback(scope, uuidParam(req.params.id), req.user!.id, body));
}

export async function note(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const { text } = textBody.parse(req.body);
  return res.status(201).json(await addNote(scope, uuidParam(req.params.id), req.user!.id, text));
}

export async function reply(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const { text } = textBody.parse(req.body);
  return res.status(201).json(await addReply(scope, uuidParam(req.params.id), req.user!.id, text));
}

export async function approveAttachment(req: AuthRequest, res: Response) {
  return res.json(await decideAttachment(scopeOr403(req), uuidParam(req.params.id), req.user!.id, 'APPROVED'));
}

export async function rejectAttachment(req: AuthRequest, res: Response) {
  return res.json(await decideAttachment(scopeOr403(req), uuidParam(req.params.id), req.user!.id, 'REJECTED'));
}

const moderateBody = z.object({ action: z.enum(['HIDE', 'FLAG', 'CLEAR']), reason: z.string().min(3).max(500) });

const bulkBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['SET_STATUS', 'ASSIGN', 'SET_PRIORITY', 'HIDE']),
  value: z.string().max(60).nullable().optional(),
  reason: z.string().max(500).optional(),
});

export async function reports(req: AuthRequest, res: Response) {
  return res.json(await listReports(scopeOr403(req)));
}

export async function moderate(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const { action, reason } = moderateBody.parse(req.body);
  return res.json(await moderateFeedback(scope, uuidParam(req.params.id), req.user!.id, action, reason));
}

export async function bulk(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const body = bulkBody.parse(req.body);
  return res.json(await bulkUpdate(scope, req.user!.id, body));
}

export async function dashboard(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const days = z.coerce.number().int().min(1).max(180).default(30).parse(req.query.days);
  return res.json(await feedbackDashboard(scope, days));
}

/** Same filters as the list endpoint; limit and cursor are ignored. Streamed, never buffered. */
export async function exportCsv(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const { assignee, limit: _l, cursor: _c, ...rest } = listQuery.parse(req.query);
  const assigneeId = assignee === 'me' ? req.user!.id : assignee;
  if (assigneeId && !idSchema.safeParse(assigneeId).success) throw new AppError(400, 'Invalid assignee');
  const filters = { ...rest, assignee: assigneeId };
  const rawBody = req.user!.role === UserRole.ADMIN || req.user!.role === UserRole.SUPER_ADMIN;

  const audit = await startExportAudit(req.user!.id, filters);
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename()}"`);
  res.setHeader('Cache-Control', 'no-store');

  let count = 0;
  let aborted = false;
  res.on('close', () => { aborted = true; });
  try {
    for await (const chunk of exportChunks(scope, filters, rawBody, (n) => { count = n; })) {
      if (aborted) break;
      if (!res.write(chunk)) await new Promise<void>((r) => res.once('drain', () => r()).once('close', () => r()));
    }
    res.end();
  } catch (err) {
    logger.error('Feedback export failed', { err: (err as Error)?.message });
    res.destroy(); // headers are already sent: cut the stream rather than send a truncated file as complete
  } finally {
    await finishExportAudit(audit.id, count).catch((e) => logger.warn('Export audit update failed', { err: e?.message }));
  }
}
