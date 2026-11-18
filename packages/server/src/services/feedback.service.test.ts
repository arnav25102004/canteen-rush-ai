import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));

import { computeAvg } from './feedbackAggregates.service';
import {
  createOrderReview, updateOrderReview, deleteOrderReview, getEligibility, ineligibleReason,
} from './feedback.service';
import { createOrderReviewSchema } from '../utils/feedbackSchemas';

const U = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';
const I1 = '33333333-3333-4333-8333-333333333333';
const I2 = '44444444-4444-4444-8444-444444444444';
const C = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-18T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

let tx: any;
let aggCalls: any[];

function setup(over: { order?: any; user?: any } = {}) {
  aggCalls = [];
  tx = {
    $executeRaw: vi.fn(async () => 1),
    feedback: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => ({ id: 'fb1', createdAt: NOW, editCount: 0, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(),
    },
    rating: {
      createMany: vi.fn(), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(), deleteMany: vi.fn(),
    },
    menuItem: {
      update: vi.fn(async ({ data }: any) => { aggCalls.push(['item', data]); return { ratingSum: 9, totalRatings: 2 }; }),
    },
    canteen: {
      update: vi.fn(async ({ data }: any) => { aggCalls.push(['canteen', data]); return { ratingSum: 14, totalRatings: 3 }; }),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(tx));
  db.user = {
    findUnique: vi.fn(async () => ({
      id: U, role: 'STUDENT', isBanned: false, isDeleted: false, institutionId: 'inst', ...over.user,
    })),
  };
  db.order = {
    findFirst: vi.fn(async () => ({
      id: O, status: 'PICKED_UP', pickedUpAt: hoursAgo(1), canteenId: C,
      items: [{ menuItemId: I1, menuItem: { name: 'Dosa' } }, { menuItemId: I2, menuItem: { name: 'Tea' } }],
      ...over.order,
    })),
  };
  db.feedback = { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) };
}

const input = (extra: any = {}) => ({
  orderId: O, clientRequestId: 'req-12345678', overallRating: 4, items: [{ menuItemId: I1, rating: 5 }], ...extra,
});

beforeEach(() => setup());

describe('computeAvg', () => {
  it('rounds to one decimal and handles zero', () => {
    expect(computeAvg(0, 0)).toBe(0);
    expect(computeAvg(14, 3)).toBe(4.7);
    expect(computeAvg(13, 3)).toBe(4.3);
    expect(computeAvg(9, 2)).toBe(4.5);
    expect(computeAvg(1, 3)).toBe(0.3);
  });
});

describe('createOrderReview', () => {
  it('increments item and canteen aggregates by the rating', async () => {
    const r = await createOrderReview(U, input() as any, NOW);
    expect(r.created).toBe(true);
    expect(aggCalls).toContainEqual(['item', { ratingSum: { increment: 5 }, totalRatings: { increment: 1 } }]);
    expect(aggCalls).toContainEqual(['canteen', { ratingSum: { increment: 4 }, totalRatings: { increment: 1 } }]);
    expect(aggCalls).toContainEqual(['canteen', { avgRating: 4.7 }]);
  });
  it('flags profanity and PII, and the author view hides moderation state', async () => {
    const r = await createOrderReview(U, input({ body: 'total shit, call 9876543210' }) as any, NOW);
    const data = tx.feedback.create.mock.calls[0][0].data;
    expect(data.moderation).toBe('FLAGGED');
    expect(data.body).toContain('9876543210');
    expect(data.bodyRedacted).not.toContain('9876543210');
    expect(r.feedback).not.toHaveProperty('moderation');
    expect(r.feedback).not.toHaveProperty('bodyRedacted');
  });
  it('returns the existing row for a repeated clientRequestId without touching aggregates', async () => {
    db.feedback.findUnique = vi.fn(async () => ({ id: 'old', createdAt: NOW, ratings: [] }));
    const r = await createOrderReview(U, input() as any, NOW);
    expect(r).toMatchObject({ created: false, feedback: { id: 'old' } });
    expect(aggCalls).toHaveLength(0);
  });
  it('409 ALREADY_REVIEWED with the existing id', async () => {
    tx.feedback.findFirst = vi.fn(async () => ({ id: 'existing' }));
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({
      status: 409, code: 'ALREADY_REVIEWED', extra: { feedbackId: 'existing' },
    });
  });
  it('404 for an order that is not the callers', async () => {
    db.order.findFirst = vi.fn(async () => null);
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({ status: 404 });
    expect(db.order.findFirst.mock.calls[0][0].where).toEqual({ id: O, userId: U });
  });
  it('409 when not picked up, 410 after 7 days', async () => {
    setup({ order: { status: 'READY', pickedUpAt: null } });
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({ status: 409 });
    setup({ order: { pickedUpAt: hoursAgo(24 * 7 + 1) } });
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({
      status: 410, code: 'REVIEW_WINDOW_CLOSED',
    });
  });
  it('rejects vendors, banned users and items outside the order', async () => {
    setup({ user: { role: 'VENDOR' } });
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({ status: 403 });
    setup({ user: { isBanned: true } });
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({ status: 403 });
    setup();
    const stranger = '66666666-6666-4666-8666-666666666666';
    await expect(
      createOrderReview(U, input({ items: [{ menuItemId: stranger, rating: 3 }] }) as any, NOW),
    ).rejects.toMatchObject({ status: 400, code: 'ITEM_NOT_IN_ORDER' });
  });
  it('enforces the 30-day cap', async () => {
    tx.feedback.count = vi.fn(async () => 50);
    await expect(createOrderReview(U, input() as any, NOW)).rejects.toMatchObject({ status: 429 });
  });
});

describe('updateOrderReview', () => {
  const existing = (over: any = {}) => ({
    id: 'fb1', userId: U, orderId: O, canteenId: C, overallRating: 4, editCount: 0, createdAt: hoursAgo(2),
    ratings: [{ id: 'r1', menuItemId: I1, rating: 5, taste: null, portion: null, value: null, tags: [] }],
    ...over,
  });
  beforeEach(() => {
    db.feedback.findFirst = vi.fn(async () => existing());
    tx.feedback.findUniqueOrThrow = vi.fn(async () => ({ ...existing(), editCount: 1 }));
  });

  it('adjusts aggregates by the difference only', async () => {
    await updateOrderReview(U, 'fb1', { overallRating: 2, items: [{ menuItemId: I1, rating: 3 }] }, NOW);
    expect(aggCalls).toContainEqual(['canteen', { ratingSum: { increment: -2 }, totalRatings: { increment: 0 } }]);
    expect(aggCalls).toContainEqual(['item', { ratingSum: { increment: -2 }, totalRatings: { increment: 0 } }]);
    const guard = tx.feedback.updateMany.mock.calls[0][0].where;
    expect(guard).toMatchObject({ editCount: 0, overallRating: 4, deletedAt: null });
  });
  it('does not touch aggregates when only the body changes', async () => {
    await updateOrderReview(U, 'fb1', { body: 'better now' }, NOW);
    expect(aggCalls).toHaveLength(0);
  });
  it('403 after 24h and after 3 edits', async () => {
    db.feedback.findFirst = vi.fn(async () => existing({ createdAt: hoursAgo(25) }));
    await expect(updateOrderReview(U, 'fb1', { body: 'x' }, NOW)).rejects.toMatchObject({ code: 'EDIT_WINDOW_CLOSED' });
    db.feedback.findFirst = vi.fn(async () => existing({ editCount: 3 }));
    await expect(updateOrderReview(U, 'fb1', { body: 'x' }, NOW)).rejects.toMatchObject({ code: 'EDIT_LIMIT' });
  });
  it('409 when a concurrent edit won the guarded update', async () => {
    tx.feedback.updateMany = vi.fn(async () => ({ count: 0 }));
    await expect(updateOrderReview(U, 'fb1', { overallRating: 1 }, NOW)).rejects.toMatchObject({ status: 409 });
  });
});

describe('deleteOrderReview', () => {
  it('decrements aggregates and removes item rows', async () => {
    tx.feedback.findUniqueOrThrow = vi.fn(async () => ({
      id: 'fb1', canteenId: C, overallRating: 4, ratings: [{ menuItemId: I1, rating: 5 }],
    }));
    await deleteOrderReview(U, 'fb1', NOW);
    expect(aggCalls).toContainEqual(['item', { ratingSum: { increment: -5 }, totalRatings: { increment: -1 } }]);
    expect(aggCalls).toContainEqual(['canteen', { ratingSum: { increment: -4 }, totalRatings: { increment: -1 } }]);
    expect(tx.rating.deleteMany).toHaveBeenCalledWith({ where: { feedbackId: 'fb1' } });
  });
  it('404 when already deleted or not owned', async () => {
    tx.feedback.updateMany = vi.fn(async () => ({ count: 0 }));
    await expect(deleteOrderReview(U, 'fb1', NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe('eligibility', () => {
  it('explains cancelled and no-show orders by pointing to app or canteen feedback', async () => {
    for (const status of ['CANCELLED', 'NO_SHOW']) {
      setup({ order: { status } });
      const r: any = await getEligibility(U, O, NOW);
      expect(r.eligible).toBe(false);
      expect(r.reason).toMatch(/canteen or the app/);
    }
  });
  it('reports the existing review and edit deadline', async () => {
    db.feedback.findFirst = vi.fn(async () => ({ id: 'fb1', createdAt: hoursAgo(1) }));
    const r: any = await getEligibility(U, O, NOW);
    expect(r).toMatchObject({ eligible: false, existingFeedbackId: 'fb1' });
    expect(r.editDeadline.getTime()).toBe(hoursAgo(1).getTime() + 24 * 3600 * 1000);
  });
  it('eligible when picked up and unreviewed', async () => {
    const r: any = await getEligibility(U, O, NOW);
    expect(r.eligible).toBe(true);
    expect(r.items).toHaveLength(2);
  });
  it('window boundary is inclusive at exactly 7 days', () => {
    expect(ineligibleReason({ status: 'PICKED_UP', pickedUpAt: hoursAgo(24 * 7) } as any, NOW)).toBeNull();
  });
});

describe('create schema edge cases', () => {
  const base = { orderId: O, clientRequestId: 'req-12345678', overallRating: 5 };
  it('accepts emoji-only bodies and counts graphemes', () => {
    const body = '\u{1F44D}\u{1F3FD}'.repeat(500);
    expect(createOrderReviewSchema.safeParse({ ...base, body }).success).toBe(true);
    expect(createOrderReviewSchema.safeParse({ ...base, body: body + '\u{1F44D}\u{1F3FD}' }).success).toBe(false);
  });
  it('rejects very long text, bad ratings and unknown tags', () => {
    expect(createOrderReviewSchema.safeParse({ ...base, body: 'a'.repeat(501) }).success).toBe(false);
    expect(createOrderReviewSchema.safeParse({ ...base, overallRating: 4.5 }).success).toBe(false);
    expect(createOrderReviewSchema.safeParse({ ...base, tags: ['nonsense'] }).success).toBe(false);
  });
});
