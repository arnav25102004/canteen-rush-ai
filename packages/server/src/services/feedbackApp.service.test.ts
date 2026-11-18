import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));

import { createAppFeedback, appPriority, PAYMENT_SUPPORT_HINT } from './feedback.service';
import { createAppFeedbackSchema, letterCount } from '../utils/feedbackSchemas';

const U = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-18T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);
const rid = () => `req-${Math.random().toString(36).slice(2, 12)}`;

let tx: any;

function setup(over: { user?: any; counts?: number[]; prior?: any } = {}) {
  const counts = [...(over.counts ?? [0, 0])];
  tx = {
    $executeRaw: vi.fn(async () => 1),
    feedback: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => counts.shift() ?? 0),
      create: vi.fn(async ({ data }: any) => ({ id: 'fb1', createdAt: NOW, editCount: 0, events: [], ...data })),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(tx));
  db.user = {
    findUnique: vi.fn(async () => ({
      id: U, isBanned: false, isDeleted: false, institutionId: 'inst', createdAt: daysAgo(10), ...over.user,
    })),
  };
  db.feedback = { findUnique: vi.fn(async () => over.prior ?? null) };
}

const bug = (extra: object = {}) =>
  createAppFeedbackSchema.parse({
    clientRequestId: rid(), kind: 'APP_BUG', body: 'The wallet screen freezes when I open it', severity: 'ANNOYING', ...extra,
  });

beforeEach(() => setup());

describe('createAppFeedbackSchema', () => {
  it('requires 10 letters for bugs and ideas, not digits or emoji', () => {
    expect(letterCount('abc 1234567890 😀😀')).toBe(3);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_BUG', severity: 'ANNOYING', body: '1234567890123' }).success).toBe(false);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_IDEA', body: 'short' }).success).toBe(false);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_IDEA', body: 'Add a dark mode please' }).success).toBe(true);
  });
  it('requires severity for bugs only', () => {
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_BUG', body: 'something is really broken' }).success).toBe(false);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_IDEA', body: 'something is really broken', severity: 'ANNOYING' }).success).toBe(false);
  });
  it('allows praise with a short body but not an empty one', () => {
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_PRAISE', body: 'Love it' }).success).toBe(true);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_PRAISE' }).success).toBe(false);
  });
  it('caps the body at 500 graphemes and the context at 8KB', () => {
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_OTHER', body: 'a'.repeat(501) }).success).toBe(false);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_OTHER', body: 'a'.repeat(500) }).success).toBe(true);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_OTHER', body: 'hello', contextJson: { x: 'y'.repeat(9000) } }).success).toBe(false);
  });
  it('rejects unknown kind, severity and tags', () => {
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'ORDER_REVIEW', body: 'hello there' }).success).toBe(false);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_BUG', body: 'hello there friend', severity: 'BAD' }).success).toBe(false);
    expect(createAppFeedbackSchema.safeParse({ clientRequestId: rid(), kind: 'APP_OTHER', body: 'hello', tags: ['nope'] }).success).toBe(false);
  });
});

describe('appPriority', () => {
  it('maps severity to priority for bugs only', () => {
    expect(appPriority('APP_BUG' as any, 'PAYMENT_ISSUE')).toBe('URGENT');
    expect(appPriority('APP_BUG' as any, 'BLOCKS_ME')).toBe('HIGH');
    expect(appPriority('APP_BUG' as any, 'ANNOYING')).toBe('NORMAL');
    expect(appPriority('APP_IDEA' as any, 'PAYMENT_ISSUE')).toBe('NORMAL');
  });
});

describe('createAppFeedback', () => {
  it('creates a payment bug as URGENT with an SLA and the support hint', async () => {
    const r = await createAppFeedback(U, bug({ severity: 'PAYMENT_ISSUE' }), NOW);
    const data = tx.feedback.create.mock.calls[0][0].data;
    expect(data.priority).toBe('URGENT');
    expect(data.slaDueAt).toEqual(new Date(NOW.getTime() + 4 * 3600 * 1000));
    expect(data.visibility).toBe('ADMIN_ONLY');
    expect(data.tags).toContain('payment');
    expect(data.contextJson.severity).toBe('PAYMENT_ISSUE');
    expect(r.created).toBe(true);
    expect(r.feedback.supportHint).toBe(PAYMENT_SUPPORT_HINT);
  });
  it('gives BLOCKS_ME HIGH priority (24h SLA) and no hint', async () => {
    const r = await createAppFeedback(U, bug({ severity: 'BLOCKS_ME' }), NOW);
    const data = tx.feedback.create.mock.calls[0][0].data;
    expect(data.priority).toBe('HIGH');
    expect(data.slaDueAt).toEqual(new Date(NOW.getTime() + 24 * 3600 * 1000));
    expect(r.feedback.supportHint).toBeUndefined();
  });
  it('flags PII for admins and stores the context', async () => {
    await createAppFeedback(U, bug({ body: 'call me on 9876543210 the app is broken', contextJson: { appVersion: '1.2.3' } }), NOW);
    const data = tx.feedback.create.mock.calls[0][0].data;
    expect(data.moderation).toBe('FLAGGED');
    expect(data.bodyRedacted).toContain('[phone removed]');
    expect(data.contextJson.appVersion).toBe('1.2.3');
  });
  it('rejects accounts younger than 24 hours', async () => {
    setup({ user: { createdAt: new Date(NOW.getTime() - 3 * 3600 * 1000) } });
    await expect(createAppFeedback(U, bug(), NOW)).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_TOO_NEW' });
    expect(tx.feedback.create).not.toHaveBeenCalled();
  });
  it('accepts an account just over 24 hours old, any role', async () => {
    setup({ user: { createdAt: new Date(NOW.getTime() - 25 * 3600 * 1000), role: 'VENDOR' } });
    expect((await createAppFeedback(U, bug(), NOW)).created).toBe(true);
  });
  it('blocks banned and deleted users', async () => {
    setup({ user: { isBanned: true } });
    await expect(createAppFeedback(U, bug(), NOW)).rejects.toMatchObject({ status: 403 });
    setup({ user: { isDeleted: true } });
    await expect(createAppFeedback(U, bug(), NOW)).rejects.toMatchObject({ status: 404 });
  });
  it('enforces 3 app feedbacks per 24h under the advisory lock', async () => {
    setup({ counts: [3, 3] });
    await expect(createAppFeedback(U, bug(), NOW)).rejects.toMatchObject({ status: 429, code: 'APP_FEEDBACK_DAILY_CAP' });
    expect(tx.$executeRaw).toHaveBeenCalled();
    const where = tx.feedback.count.mock.calls[0][0].where;
    expect(where.kind.in).toHaveLength(4);
    expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 24 * 3600 * 1000));
  });
  it('enforces the 50 per 30 days cap', async () => {
    setup({ counts: [0, 50] });
    await expect(createAppFeedback(U, bug(), NOW)).rejects.toMatchObject({ status: 429, code: 'FEEDBACK_CAP' });
  });
  it('is idempotent on clientRequestId, even for a too-new account', async () => {
    setup({ prior: { id: 'old', kind: 'APP_BUG', createdAt: NOW, events: [] }, user: { createdAt: NOW } });
    const r = await createAppFeedback(U, bug(), NOW);
    expect(r).toMatchObject({ created: false });
    expect(r.feedback.id).toBe('old');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('returns the existing row when the in-transaction lookup finds one', async () => {
    tx.feedback.findUnique = vi.fn(async () => ({ id: 'raced', kind: 'APP_BUG', createdAt: NOW, events: [] }));
    const r = await createAppFeedback(U, bug(), NOW);
    expect(r.created).toBe(false);
    expect(tx.feedback.create).not.toHaveBeenCalled();
  });
});
