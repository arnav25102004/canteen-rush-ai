import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));
vi.mock('../config/firebase', () => ({ sendPushNotification: vi.fn() }));

import {
  awardPointsForFeedback, awardHelpfulBonus, reverseFeedbackPoints, passesQualityGate, computeStreak,
  istWeekIndex, istDayStartOf, FEEDBACK_DAILY_CAP,
} from './loyalty.service';
import { moodValue, getMoodsForCanteens, getCanteenSummary } from './feedbackMood.service';
import { publishChangelog, listChangelog } from './feedbackChangelog.service';

const U = 'user-1';
const FB = 'fb-1';
const ORD = 'ord-1';
const NOW = new Date('2026-11-18T12:00:00Z');
const OLD_ACCOUNT = new Date('2026-01-01T00:00:00Z');

let tx: any;
let balance: number;

function setup(over: { fb?: any; user?: any; todaySum?: number; orderAwards?: number; existing?: any } = {}) {
  balance = 50;
  tx = {
    $executeRaw: vi.fn(async () => 1),
    pointTransaction: {
      findUnique: vi.fn(async () => over.existing ?? null),
      count: vi.fn(async () => over.orderAwards ?? 0),
      aggregate: vi.fn(async () => ({ _sum: { points: over.todaySum ?? 0 } })),
      create: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
    },
    feedback: {
      findFirst: vi.fn(async () => ({ tags: ['tasty'], body: null, moderation: 'CLEAN', editCount: 0, userId: U, orderId: ORD, ...over.fb })),
    },
    user: { findUnique: vi.fn(async () => ({ createdAt: OLD_ACCOUNT, isDeleted: false, isBanned: false, ...over.user })) },
    loyaltyAccount: {
      upsert: vi.fn(async () => ({ id: 'acct', totalPoints: balance })),
      update: vi.fn(async ({ data }: any) => { balance += data.totalPoints.increment; return {}; }),
      findUniqueOrThrow: vi.fn(async () => ({ id: 'acct', totalPoints: balance })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (balance < where.totalPoints.gte) return { count: 0 };
        balance -= data.totalPoints.decrement;
        return { count: 1 };
      }),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(tx));
}

const args = { userId: U, feedbackId: FB, orderId: ORD };

beforeEach(() => { vi.clearAllMocks(); setup(); });

describe('quality gate', () => {
  it('needs a tag or 15+ characters', () => {
    expect(passesQualityGate({ tags: [], body: null })).toBe(false);
    expect(passesQualityGate({ tags: [], body: 'too short' })).toBe(false);
    expect(passesQualityGate({ tags: [], body: 'the paneer was really good' })).toBe(true);
    expect(passesQualityGate({ tags: ['tasty'], body: null })).toBe(true);
  });
  it('refuses a low-quality review without touching the balance', async () => {
    setup({ fb: { tags: [], body: 'ok' } });
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'low_quality' });
    expect(tx.pointTransaction.create).not.toHaveBeenCalled();
  });
});

describe('awardPointsForFeedback', () => {
  it('awards 10 BONUS points tied to the feedback', async () => {
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: true, points: 10 });
    expect(tx.loyaltyAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct' }, data: { totalPoints: { increment: 10 }, lifetimePoints: { increment: 10 } },
    });
    const data = tx.pointTransaction.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: 'BONUS', points: 10, feedbackId: FB, orderId: ORD, balanceAfter: 60 });
  });

  it('swallows a duplicate unique violation (never a 500)', async () => {
    tx.pointTransaction.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'already_awarded' });
  });

  it('is a no-op when this feedback was already awarded', async () => {
    setup({ existing: { id: 'pt' } });
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'already_awarded' });
    expect(tx.pointTransaction.create).not.toHaveBeenCalled();
  });

  it('rethrows other errors', async () => {
    tx.pointTransaction.create.mockRejectedValueOnce(new Error('db down'));
    await expect(awardPointsForFeedback(db, args, NOW)).rejects.toThrow('db down');
  });

  it('awards once per order, even for a re-written review', async () => {
    setup({ orderAwards: 1 });
    expect((await awardPointsForFeedback(db, args, NOW))).toEqual({ awarded: false, reason: 'order_already_awarded' });
  });

  it('stops at the daily cap of 30', async () => {
    setup({ todaySum: FEEDBACK_DAILY_CAP });
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'daily_cap' });
    setup({ todaySum: 20 });
    expect((await awardPointsForFeedback(db, args, NOW)).awarded).toBe(true);
  });

  it('counts the day in IST', async () => {
    await awardPointsForFeedback(db, args, new Date('2026-11-18T20:00:00Z')); // 01:30 IST on the 19th
    const gte = tx.pointTransaction.aggregate.mock.calls[0][0].where.createdAt.gte as Date;
    expect(gte.toISOString()).toBe('2026-11-18T18:30:00.000Z');
  });

  it('needs an account older than 24 hours', async () => {
    setup({ user: { createdAt: new Date(NOW.getTime() - 3600_000) } });
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'account_too_new' });
  });

  it.each(['FLAGGED', 'HIDDEN'])('gives nothing for %s content', async (moderation) => {
    setup({ fb: { moderation } });
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'moderated' });
  });

  it('gives nothing for edited reviews or when the review is not an ORDER_REVIEW of this user', async () => {
    setup({ fb: { editCount: 1 } });
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'edited' });
    tx.feedback.findFirst.mockResolvedValueOnce(null);
    expect(await awardPointsForFeedback(db, args, NOW)).toEqual({ awarded: false, reason: 'not_found' });
    expect(tx.feedback.findFirst.mock.calls[0][0].where).toMatchObject({ kind: 'ORDER_REVIEW', userId: U, orderId: ORD });
  });

  it('works with a caller-supplied transaction client', async () => {
    db.$transaction.mockClear();
    expect((await awardPointsForFeedback(tx, args, NOW)).awarded).toBe(true);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('awardHelpfulBonus', () => {
  it('awards once with its own unique key', async () => {
    expect(await awardHelpfulBonus(db, FB, NOW)).toEqual({ awarded: true, points: 10 });
    expect(tx.pointTransaction.create.mock.calls[0][0].data).toMatchObject({ helpfulFeedbackId: FB, type: 'BONUS' });
    expect(tx.pointTransaction.create.mock.calls[0][0].data.feedbackId).toBeUndefined();
  });
  it('is a no-op the second time and never throws on a race', async () => {
    tx.pointTransaction.findUnique.mockResolvedValueOnce({ id: 'x' });
    expect((await awardHelpfulBonus(db, FB, NOW)).awarded).toBe(false);
    tx.pointTransaction.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    expect((await awardHelpfulBonus(db, FB, NOW)).awarded).toBe(false);
  });
  it('skips moderated or authorless feedback', async () => {
    tx.feedback.findFirst.mockResolvedValueOnce({ userId: null, moderation: 'CLEAN', orderId: null });
    expect(await awardHelpfulBonus(db, FB, NOW)).toEqual({ awarded: false, reason: 'no_author' });
    tx.feedback.findFirst.mockResolvedValueOnce({ userId: U, moderation: 'HIDDEN', orderId: null });
    expect(await awardHelpfulBonus(db, FB, NOW)).toEqual({ awarded: false, reason: 'moderated' });
  });
});

describe('reverseFeedbackPoints', () => {
  beforeEach(() => {
    tx.pointTransaction.findFirst
      .mockResolvedValueOnce({ loyaltyId: 'acct' }) // the award
      .mockResolvedValueOnce(null); // no earlier reversal
    tx.pointTransaction.aggregate.mockResolvedValue({ _sum: { points: 10 } });
  });
  it('writes a negative BONUS row', async () => {
    expect(await reverseFeedbackPoints(FB)).toEqual({ reversed: 10 });
    expect(tx.pointTransaction.create.mock.calls[0][0].data).toMatchObject({ type: 'BONUS', points: -10, balanceAfter: 40 });
  });
  it('never takes the balance below 0', async () => {
    balance = 4; // the user already spent most of it
    expect(await reverseFeedbackPoints(FB)).toEqual({ reversed: 4 });
    expect(balance).toBe(0);
    expect(tx.pointTransaction.create.mock.calls[0][0].data.points).toBe(-4);
  });
  it('does nothing at a zero balance, and nothing twice', async () => {
    balance = 0;
    expect(await reverseFeedbackPoints(FB)).toEqual({ reversed: 0 });
    expect(tx.pointTransaction.create).not.toHaveBeenCalled();
  });
  it('is idempotent through the reversal marker', async () => {
    tx.pointTransaction.findFirst.mockReset();
    tx.pointTransaction.findFirst.mockResolvedValueOnce({ loyaltyId: 'acct' }).mockResolvedValueOnce({ id: 'done' });
    expect(await reverseFeedbackPoints(FB)).toEqual({ reversed: 0 });
    expect(balance).toBe(50);
  });
  it('retries when a concurrent spend beats the conditional update', async () => {
    tx.loyaltyAccount.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await reverseFeedbackPoints(FB)).toEqual({ reversed: 10 });
    expect(tx.loyaltyAccount.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('streak across IST week boundaries', () => {
  // Weeks start Monday 00:00 IST. Sun 2026-11-15 18:29Z is 23:59 IST Sunday; 18:30Z is Monday 00:00 IST.
  it('puts the boundary at Monday midnight IST', () => {
    const sun = new Date('2026-11-15T18:29:00Z');
    const mon = new Date('2026-11-15T18:30:00Z');
    expect(istWeekIndex(mon)).toBe(istWeekIndex(sun) + 1);
    expect(istDayStartOf(mon).toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });
  it('counts consecutive weeks, ending this week', () => {
    const d = (s: string) => new Date(s);
    const r = computeStreak([d('2026-11-18T05:00:00Z'), d('2026-11-11T05:00:00Z'), d('2026-11-04T05:00:00Z')], NOW);
    expect(r).toEqual({ current: 3, best: 3 });
  });
  it('two reviews in one week count once; a gap resets the run but keeps best', () => {
    const d = (s: string) => new Date(s);
    const r = computeStreak(
      [d('2026-11-18T05:00:00Z'), d('2026-11-17T05:00:00Z'), d('2026-11-04T05:00:00Z'), d('2026-10-28T05:00:00Z'), d('2026-10-21T05:00:00Z')],
      NOW,
    );
    expect(r).toEqual({ current: 1, best: 3 });
  });
  it('stays alive through last week, dies after a fully empty week', () => {
    const d = (s: string) => new Date(s);
    expect(computeStreak([d('2026-11-11T05:00:00Z')], NOW).current).toBe(1); // last week
    expect(computeStreak([d('2026-11-04T05:00:00Z')], NOW)).toEqual({ current: 0, best: 1 }); // two weeks ago
    expect(computeStreak([], NOW)).toEqual({ current: 0, best: 0 });
  });
  it('a Sunday-night and Monday-morning pair are two consecutive weeks', () => {
    const r = computeStreak([new Date('2026-11-15T18:29:00Z'), new Date('2026-11-15T18:31:00Z')], NOW);
    expect(r.best).toBe(2);
  });
});

describe('mood score', () => {
  it('hides with 9 ratings and shows with 10', () => {
    expect(moodValue(4.33, 9)).toBeNull();
    expect(moodValue(4.33, 10)).toBe(4.3);
    expect(moodValue(null, 50)).toBeNull();
  });

  it('uses one grouped query, 7-day window, excluding flagged, hidden and deleted', async () => {
    db.feedback = {
      groupBy: vi.fn(async () => [
        { canteenId: 'c1', _avg: { overallRating: 4.26 }, _count: { _all: 12 } },
        { canteenId: 'c2', _avg: { overallRating: 5 }, _count: { _all: 9 } },
      ]),
    };
    const m = await getMoodsForCanteens(['c1', 'c2', 'c3'], NOW);
    expect(db.feedback.groupBy).toHaveBeenCalledTimes(1);
    const where = db.feedback.groupBy.mock.calls[0][0].where;
    expect(where.moderation).toEqual({ notIn: ['FLAGGED', 'HIDDEN'] });
    expect(where.deletedAt).toBeNull();
    expect(where.createdAt.gte.toISOString()).toBe('2026-11-11T12:00:00.000Z');
    expect(m.get('c1')).toEqual({ mood: 4.3, moodCount: 12 });
    expect(m.get('c2')).toEqual({ mood: null, moodCount: 9 });
    expect(m.has('c3')).toBe(false);
  });

  it('summary: institution scoped, tags hidden under threshold, no text ever', async () => {
    db.canteen = { findFirst: vi.fn(async () => null) };
    await expect(getCanteenSummary('c1', 'inst', NOW)).rejects.toMatchObject({ status: 404 });
    expect(db.canteen.findFirst.mock.calls[0][0].where).toEqual({ id: 'c1', institutionId: 'inst' });

    db.canteen.findFirst = vi.fn(async () => ({ id: 'c1' }));
    db.feedback = {
      aggregate: vi.fn(async () => ({ _avg: { overallRating: 4.2 }, _count: { _all: 9 } })),
      findMany: vi.fn(),
    };
    expect(await getCanteenSummary('c1', 'inst', NOW)).toEqual({ mood: null, count: 9, tags: [], window: '7d' });
    expect(db.feedback.findMany).not.toHaveBeenCalled();

    db.feedback.aggregate = vi.fn(async () => ({ _avg: { overallRating: 4.26 }, _count: { _all: 10 } }));
    db.feedback.findMany = vi.fn(async () => [{ tags: ['tasty', 'fresh'] }, { tags: ['tasty', 'not-a-real-tag'] }]);
    const out: any = await getCanteenSummary('c1', 'inst', NOW);
    expect(out.mood).toBe(4.3);
    expect(out.tags[0]).toEqual({ tag: 'tasty', count: 2 });
    expect(out.tags.find((t: any) => t.tag === 'not-a-real-tag')).toBeUndefined();
    expect(db.feedback.findMany.mock.calls[0][0].select).toEqual({ tags: true }); // never body text
    expect(JSON.stringify(out)).not.toMatch(/body/);
  });
});

describe('changelog', () => {
  let ctx: any;
  function csetup(linked: any[]) {
    ctx = {
      changelogEntry: { create: vi.fn(async ({ data }: any) => ({ id: 'cl1', createdAt: NOW, ...data })) },
      feedback: { updateMany: vi.fn(async () => ({ count: 1 })) },
      feedbackEvent: { create: vi.fn(async () => ({})) },
    };
    db.$transaction = vi.fn(async (fn: any) => fn(ctx));
    db.feedback = { findMany: vi.fn(async () => linked) };
    db.canteen = { findFirst: vi.fn(async () => ({ id: 'c1', institutionId: 'inst' })) };
    db.notification = { create: vi.fn(async () => ({})) };
    db.user = { findUnique: vi.fn(async () => ({ fcmToken: null })) };
  }
  const base = { title: 'Fresher parathas', body: 'We changed the oil.' };

  it('rejects linked feedback outside the admin scope', async () => {
    csetup([{ id: 'f1', userId: 'u1', status: 'SEEN', firstSeenAt: null }]);
    await expect(
      publishChangelog({ institutionId: 'inst' }, 'admin', { ...base, linkedFeedbackIds: ['f1', 'f-other'] }, NOW),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.feedback.findMany.mock.calls[0][0].where).toMatchObject({ institutionId: 'inst', deletedAt: null });
    expect(ctx.changelogEntry.create).not.toHaveBeenCalled();
  });

  it('scopes the canteen too', async () => {
    csetup([]);
    db.canteen.findFirst.mockResolvedValueOnce(null);
    await expect(
      publishChangelog({ institutionId: 'inst' }, 'admin', { ...base, canteenId: 'foreign', linkedFeedbackIds: [] }, NOW),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.canteen.findFirst.mock.calls[0][0].where).toEqual({ id: 'foreign', institutionId: 'inst' });
  });

  it('notifies each author once, anonymous included, and does not resolve unless asked', async () => {
    csetup([
      { id: 'f1', userId: 'u1', status: 'SEEN', firstSeenAt: null },
      { id: 'f2', userId: 'u1', status: 'RECEIVED', firstSeenAt: null }, // same author twice
      { id: 'f3', userId: 'u2', status: 'IN_PROGRESS', firstSeenAt: null }, // anonymous author, still notified
      { id: 'f4', userId: null, status: 'SEEN', firstSeenAt: null }, // deleted account
    ]);
    const out = await publishChangelog({ institutionId: 'inst' }, 'admin', { ...base, linkedFeedbackIds: ['f1', 'f2', 'f3', 'f4'] }, NOW);
    expect(out.notified).toBe(2);
    const rows = db.notification.create.mock.calls.map((c: any) => c[0].data);
    expect(rows.map((r: any) => r.userId).sort()).toEqual(['u1', 'u2']);
    expect(rows.every((r: any) => r.type === 'feedback_changelog')).toBe(true);
    expect(ctx.feedbackEvent.create).not.toHaveBeenCalled();
    expect(ctx.feedback.updateMany).toHaveBeenCalledTimes(1); // only the link
  });

  it('resolves linked feedback conditionally when markResolved is set, skipping closed ones', async () => {
    csetup([
      { id: 'f1', userId: 'u1', status: 'SEEN', firstSeenAt: null },
      { id: 'f2', userId: 'u2', status: 'RESOLVED', firstSeenAt: NOW },
    ]);
    await publishChangelog({ institutionId: 'inst' }, 'admin', { ...base, linkedFeedbackIds: ['f1', 'f2'], markResolved: true }, NOW);
    const resolve = ctx.feedback.updateMany.mock.calls.find((c: any) => c[0].data.status === 'RESOLVED')[0];
    expect(resolve.where).toEqual({ id: 'f1', institutionId: 'inst', status: 'SEEN' });
    expect(ctx.feedbackEvent.create).toHaveBeenCalledTimes(1);
  });

  it('caps links at 20', async () => {
    csetup([]);
    const ids = Array.from({ length: 21 }, (_, i) => `f${i}`);
    await expect(publishChangelog({}, 'admin', { ...base, linkedFeedbackIds: ids }, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('student list is limited to the institution and platform-wide entries, published only', async () => {
    db.changelogEntry = { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) };
    await listChangelog('inst', 1, 20);
    expect(db.changelogEntry.findMany.mock.calls[0][0]).toMatchObject({
      where: { publishedAt: { not: null }, OR: [{ institutionId: null }, { institutionId: 'inst' }] },
      orderBy: { publishedAt: 'desc' },
    });
  });
});
