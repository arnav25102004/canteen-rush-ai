import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest, feedbackScope } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { getFeedbackStreak } from '../services/loyalty.service';
import { getCanteenSummary } from '../services/feedbackMood.service';
import { listChangelog, listChangelogAdmin, publishChangelog } from '../services/feedbackChangelog.service';
import { cleanText } from '../utils/feedbackSchemas';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const publishSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(500),
  canteenId: z.string().uuid().nullable().optional(),
  linkedFeedbackIds: z.array(z.string().uuid()).max(20).default([]),
  markResolved: z.boolean().optional(),
});

export async function streak(req: AuthRequest, res: Response) {
  return res.json(await getFeedbackStreak(req.user!.id));
}

export async function canteenSummary(req: AuthRequest, res: Response) {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw new AppError(404, 'Not found');
  return res.json(await getCanteenSummary(id.data, req.user!.institutionId));
}

export async function changelog(req: AuthRequest, res: Response) {
  const { page, limit } = pageSchema.parse(req.query);
  return res.json(await listChangelog(req.user!.institutionId, page, limit));
}

function scopeOr403(req: AuthRequest) {
  const scope = feedbackScope(req);
  if (!scope) throw new AppError(403, 'Forbidden: no feedback scope');
  return scope;
}

export async function adminPublish(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const b = publishSchema.parse(req.body);
  const out = await publishChangelog(scope, req.user!.id, { ...b, title: cleanText(b.title), body: cleanText(b.body) });
  return res.status(201).json(out);
}

export async function adminList(req: AuthRequest, res: Response) {
  const scope = scopeOr403(req);
  const { page, limit } = pageSchema.parse(req.query);
  return res.json(await listChangelogAdmin(scope, page, limit));
}
