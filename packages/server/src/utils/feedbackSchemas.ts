import { z } from 'zod';

/** Tags a student may attach. Anything else is rejected, so vendors never see free-form labels. */
export const FOOD_TAGS = [
  'tasty', 'fresh', 'hot', 'cold', 'bland', 'too_spicy', 'too_oily', 'stale',
  'good_portion', 'small_portion', 'great_value', 'overpriced', 'late', 'quick', 'wrong_item', 'packaging',
] as const;
export const CANTEEN_TAGS = ['friendly_staff', 'rude_staff', 'clean', 'dirty', 'short_queue', 'long_queue'] as const;
export const APP_TAGS = ['payment', 'login', 'crash', 'slow', 'ui', 'notifications', 'wallet', 'slots', 'menu', 'other'] as const;

export const FEEDBACK_TAGS: readonly string[] = [...FOOD_TAGS, ...CANTEEN_TAGS, ...APP_TAGS];

export const BODY_MAX_GRAPHEMES = 500;
export const CONTEXT_MAX_BYTES = 8 * 1024;
export const MAX_TAGS = 5;

// Intl.Segmenter is in Node 16+ but not in the ES2020 lib typings.
const segmenter: { segment(s: string): Iterable<unknown> } = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });

/** Number of user-perceived characters (an emoji with modifiers counts once). */
export function graphemeLength(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

/** NFC-normalise, drop control and zero-width characters, collapse spaces, trim. */
export function cleanText(s: string): string {
  return s
    .normalize('NFC')
    // keep \n, drop other control chars and zero-width / bidi marks
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const rating5 = z.number().int().min(1).max(5);

export const feedbackBody = z
  .string()
  .transform(cleanText)
  .refine((s) => graphemeLength(s) <= BODY_MAX_GRAPHEMES, { message: `Max ${BODY_MAX_GRAPHEMES} characters` });

export const feedbackTags = z
  .array(z.string().refine((t) => FEEDBACK_TAGS.includes(t), { message: 'Unknown tag' }))
  .max(MAX_TAGS)
  .transform((tags) => [...new Set(tags)]);

export const contextJson = z
  .record(z.string(), z.unknown())
  .refine((o) => Buffer.byteLength(JSON.stringify(o), 'utf8') <= CONTEXT_MAX_BYTES, { message: 'Context too large' });

export const itemRatingSchema = z.object({
  menuItemId: z.string().uuid(),
  rating: rating5,
  taste: rating5.optional(),
  portion: rating5.optional(),
  value: rating5.optional(),
  tags: feedbackTags.optional(),
});

export const createOrderReviewSchema = z.object({
  orderId: z.string().uuid(),
  clientRequestId: z.string().min(8).max(64),
  overallRating: rating5,
  tags: feedbackTags.optional(),
  body: feedbackBody.optional(),
  isAnonymous: z.boolean().optional(),
  shareNameWithCanteen: z.boolean().optional(),
  items: z.array(itemRatingSchema).max(30).optional(),
});

export const updateFeedbackSchema = z
  .object({
    overallRating: rating5.optional(),
    tags: feedbackTags.optional(),
    body: feedbackBody.nullable().optional(),
    items: z.array(itemRatingSchema).max(30).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

export type CreateOrderReviewInput = z.infer<typeof createOrderReviewSchema>;
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;
