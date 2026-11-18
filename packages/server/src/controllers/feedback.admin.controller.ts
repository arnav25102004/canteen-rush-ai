import { Response } from 'express';
import { z } from 'zod';
import { FeedbackKind, FeedbackPriority, FeedbackStatus } from '@prisma/client';
import { AuthRequest, feedbackScope } from '../middleware/auth';
import { AppError } from '../utils/errors';
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
