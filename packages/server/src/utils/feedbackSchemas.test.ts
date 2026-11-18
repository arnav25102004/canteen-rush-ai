import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({ prisma: {} }));
vi.mock('../config/firebase', () => ({ verifyFirebaseToken: vi.fn() }));

import { UserRole } from '@prisma/client';
import {
  graphemeLength, cleanText, createOrderReviewSchema, updateFeedbackSchema, contextJson, FEEDBACK_TAGS,
} from './feedbackSchemas';
import { feedbackScope, AuthRequest } from '../middleware/auth';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const base = { orderId: uuid, clientRequestId: 'req-12345678', overallRating: 4 };

describe('graphemeLength / cleanText', () => {
  it('counts emoji sequences once', () => {
    expect(graphemeLength('abc')).toBe(3);
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
    expect(graphemeLength('👍🏽')).toBe(1);
  });
  it('strips control and zero-width characters and normalises', () => {
    expect(cleanText('  a​b\u0007c  ')).toBe('abc');
    expect(cleanText('é')).toBe('é');
  });
});

describe('createOrderReviewSchema', () => {
  it('accepts a minimal one-tap review', () => {
    expect(createOrderReviewSchema.safeParse(base).success).toBe(true);
  });
  it('rejects out-of-range ratings and unknown tags', () => {
    expect(createOrderReviewSchema.safeParse({ ...base, overallRating: 6 }).success).toBe(false);
    expect(createOrderReviewSchema.safeParse({ ...base, tags: ['nope'] }).success).toBe(false);
    expect(createOrderReviewSchema.safeParse({ ...base, tags: [FEEDBACK_TAGS[0]] }).success).toBe(true);
  });
  it('limits the body to 500 graphemes, not code units', () => {
    expect(createOrderReviewSchema.safeParse({ ...base, body: '👍'.repeat(500) }).success).toBe(true);
    expect(createOrderReviewSchema.safeParse({ ...base, body: 'a'.repeat(501) }).success).toBe(false);
  });
  it('dedupes tags and cleans the body', () => {
    const r = createOrderReviewSchema.parse({ ...base, tags: ['tasty', 'tasty'], body: ' hi​ ' });
    expect(r.tags).toEqual(['tasty']);
    expect(r.body).toBe('hi');
  });
});

describe('updateFeedbackSchema / contextJson', () => {
  it('requires at least one field', () => {
    expect(updateFeedbackSchema.safeParse({}).success).toBe(false);
    expect(updateFeedbackSchema.safeParse({ overallRating: 2 }).success).toBe(true);
  });
  it('caps context at 8 KB', () => {
    expect(contextJson.safeParse({ a: 'x'.repeat(100) }).success).toBe(true);
    expect(contextJson.safeParse({ a: 'x'.repeat(9000) }).success).toBe(false);
  });
});

describe('feedbackScope', () => {
  const req = (user?: Partial<NonNullable<AuthRequest['user']>>) =>
    ({ user: user && { id: 'u', firebaseUid: 'f', email: 'e', name: 'n', ...user } }) as AuthRequest;

  it('scopes an admin to their institution', () => {
    expect(feedbackScope(req({ role: UserRole.ADMIN, institutionId: 'i1' }))).toEqual({ institutionId: 'i1' });
  });
  it('gives a super admin everything', () => {
    expect(feedbackScope(req({ role: UserRole.SUPER_ADMIN }))).toEqual({});
  });
  it('scopes a vendor to their canteen', () => {
    expect(feedbackScope(req({ role: UserRole.VENDOR, canteenId: 'c1' }))).toEqual({ canteenId: 'c1' });
  });
  it('denies others, institution-less admins, canteen-less vendors and anonymous callers', () => {
    expect(feedbackScope(req({ role: UserRole.STUDENT }))).toBeNull();
    expect(feedbackScope(req({ role: UserRole.FACULTY }))).toBeNull();
    expect(feedbackScope(req({ role: UserRole.ADMIN, institutionId: null }))).toBeNull();
    expect(feedbackScope(req({ role: UserRole.VENDOR }))).toBeNull();
    expect(feedbackScope(req())).toBeNull();
  });
});
