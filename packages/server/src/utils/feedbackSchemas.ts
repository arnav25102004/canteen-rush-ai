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

export const APP_KINDS = ['APP_BUG', 'APP_IDEA', 'APP_PRAISE', 'APP_OTHER'] as const;
export const APP_SEVERITIES = ['ANNOYING', 'BLOCKS_ME', 'PAYMENT_ISSUE'] as const;
export const MIN_APP_BODY_LETTERS = 10;

export function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

export const createAppFeedbackSchema = z
  .object({
    clientRequestId: z.string().min(8).max(64),
    kind: z.enum(APP_KINDS),
    body: feedbackBody.optional(),
    severity: z.enum(APP_SEVERITIES).optional(),
    tags: feedbackTags.optional(),
    isAnonymous: z.boolean().optional(),
    contextJson: contextJson.optional(),
  })
  .superRefine((o, ctx) => {
    if ((o.kind === 'APP_BUG' || o.kind === 'APP_IDEA') && letterCount(o.body ?? '') < MIN_APP_BODY_LETTERS) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: `Please write at least ${MIN_APP_BODY_LETTERS} letters` });
    }
    if (o.kind === 'APP_BUG' && !o.severity) {
      ctx.addIssue({ code: 'custom', path: ['severity'], message: 'Severity is required for bugs' });
    }
    if (o.kind !== 'APP_BUG' && o.severity) {
      ctx.addIssue({ code: 'custom', path: ['severity'], message: 'Severity applies to bugs only' });
    }
    if ((o.kind === 'APP_PRAISE' || o.kind === 'APP_OTHER') && letterCount(o.body ?? '') < 1) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Please write something' });
    }
    const merged = { ...(o.contextJson ?? {}), severity: o.severity };
    if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > CONTEXT_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', path: ['contextJson'], message: 'Context too large' });
    }
  });

export type CreateAppFeedbackInput = z.infer<typeof createAppFeedbackSchema>;
export type CreateOrderReviewInput = z.infer<typeof createOrderReviewSchema>;
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;
