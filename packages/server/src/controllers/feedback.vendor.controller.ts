import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest, feedbackScope } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { flagUnfair, listVendorFeedback, replyToFeedback, vendorSummary } from '../services/vendorFeedback.service';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const summarySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const replySchema = z.object({ text: z.string().max(2000) });
const flagSchema = z.object({ reason: z.string().max(2000).optional().default('') });

function vendorCtx(req: AuthRequest): { id: string; canteenId: string } {
  const canteenId = feedbackScope(req)?.canteenId;
  if (!canteenId) throw new AppError(403, 'Forbidden: no canteen assigned');
  return { id: req.user!.id, canteenId };
}

function uuidParam(v: unknown): string {
  const r = z.string().uuid().safeParse(v);
  if (!r.success) throw new AppError(404, 'Not found');
  return r.data;
}

export async function list(req: AuthRequest, res: Response) {
  const { page, limit } = pageSchema.parse(req.query);
  return res.json(await listVendorFeedback(vendorCtx(req).canteenId, page, limit));
}

export async function summary(req: AuthRequest, res: Response) {
  const { days } = summarySchema.parse(req.query);
  return res.json(await vendorSummary(vendorCtx(req).canteenId, days));
}

export async function reply(req: AuthRequest, res: Response) {
  const { text } = replySchema.parse(req.body);
  return res.status(201).json(await replyToFeedback(vendorCtx(req), uuidParam(req.params.id), text));
}

export async function flag(req: AuthRequest, res: Response) {
  const { reason } = flagSchema.parse(req.body ?? {});
  return res.json(await flagUnfair(vendorCtx(req), uuidParam(req.params.id), reason));
}
