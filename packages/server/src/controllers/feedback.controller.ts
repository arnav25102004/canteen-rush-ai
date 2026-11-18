import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { createAppFeedbackSchema, createOrderReviewSchema, updateFeedbackSchema } from '../utils/feedbackSchemas';
import {
  createAppFeedback, createOrderReview, deleteOrderReview, getEligibility, getMine, listMine, updateOrderReview,
} from '../services/feedback.service';

const idSchema = z.string().uuid();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function uuidParam(v: unknown): string {
  const r = idSchema.safeParse(v);
  // A malformed id can never match a row: answer 404 like any other miss.
  if (!r.success) throw new AppError(404, 'Not found');
  return r.data;
}

export async function eligibility(req: AuthRequest, res: Response) {
  return res.json(await getEligibility(req.user!.id, uuidParam(req.params.orderId)));
}

export async function createOrder(req: AuthRequest, res: Response) {
  const input = createOrderReviewSchema.parse(req.body);
  const { feedback, created } = await createOrderReview(req.user!.id, input);
  if (created) logger.info('Order review created', { feedbackId: feedback.id });
  return res.status(created ? 201 : 200).json({ feedback });
}

export async function createApp(req: AuthRequest, res: Response) {
  const input = createAppFeedbackSchema.parse(req.body);
  const { feedback, created } = await createAppFeedback(req.user!.id, input);
  if (created) logger.info('App feedback created', { feedbackId: feedback.id });
  return res.status(created ? 201 : 200).json({ feedback });
}

export async function update(req: AuthRequest, res: Response) {
  const input = updateFeedbackSchema.parse(req.body);
  return res.json({ feedback: await updateOrderReview(req.user!.id, uuidParam(req.params.id), input) });
}

export async function remove(req: AuthRequest, res: Response) {
  await deleteOrderReview(req.user!.id, uuidParam(req.params.id));
  return res.json({ success: true });
}

export async function mine(req: AuthRequest, res: Response) {
  const { page, limit } = pageSchema.parse(req.query);
  return res.json(await listMine(req.user!.id, page, limit));
}

export async function getOne(req: AuthRequest, res: Response) {
  return res.json({ feedback: await getMine(req.user!.id, uuidParam(req.params.id)) });
}
