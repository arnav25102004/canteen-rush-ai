import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));
const sendPush = vi.hoisted(() => vi.fn());
vi.mock('../config/firebase', () => ({ sendPushNotification: sendPush }));

import { moderateFeedback, bulkUpdate, reportFeedback, listReports } from './feedbackModerationAdmin.service';
import { computeAvg } from './feedbackAggregates.service';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '44444444-4444-4444-8444-444444444444';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const scope = { institutionId: 'inst-1' };

let tx: any;
let rows: Record<string, any>;
let menu: { ratingSum: number; totalRatings: number; avgRating: number };
let canteen: { ratingSum: number; totalRatings: number; avgRating: number };

function review(over: any = {}) {
  return {
    id: ID, kind: 'ORDER_REVIEW', canteenId: 'c1', overallRating: 4, moderation: 'CLEAN', status: 'RECEIVED',
    priority: 'NORMAL', assignedTo: null, userId: STUDENT, createdAt: new Date(), firstSeenAt: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  menu = { ratingSum: 9, totalRatings: 2, avgRating: 4.5 };
  canteen = { ratingSum: 13, totalRatings: 3, avgRating: 4.3 };
  rows = { [ID]: review(), [ID2]: review({ id: ID2 }) };
  tx = {
    feedback: {
      // Conditional: honours the moderation/status/priority/assignedTo guards in `where`.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = rows[where.id];
        if (!r) return { count: 0 };
        for (const k of ['moderation', 'status', 'priority', 'assignedTo']) if (k in where && where[k] !== r[k]) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
      findMany: vi.fn(async ({ where }: any) => where.id.in.map((i: string) => rows[i] && { ...rows[i] }).filter(Boolean)),
    },
    feedbackEvent: { create: vi.fn(async () => ({})) },
    feedbackReport: { updateMany: vi.fn(async () => ({ count: 1 })) },
    rating: { findMany: vi.fn(async () => [{ menuItemId: 'm1', rating: 4 }]) },
    menuItem: {
      update: vi.fn(async ({ data }: any) => {
        if (data.ratingSum) { menu.ratingSum += data.ratingSum.increment; menu.totalRatings += data.totalRatings.increment; }
        if (data.avgRating != null) menu.avgRating = data.avgRating;
        return { ...menu };
      }),
    },
    canteen: {
      update: vi.fn(async ({ data }: any) => {
        if (data.ratingSum) { canteen.ratingSum += data.ratingSum.increment; canteen.totalRatings += data.totalRatings.increment; }
        if (data.avgRating != null) canteen.avgRating = data.avgRating;
        return { ...canteen };
      }),
    },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(tx));
  db.feedback = { findFirst: vi.fn(async ({ where }: any) => (where.institutionId === 'other' ? null : rows[where.id] ? { ...rows[where.id] } : null)) };
  db.user = { findFirst: vi.fn(async () => ({ id: ADMIN })), findUnique: vi.fn(async () => null) };
  db.notification = { create: vi.fn(async () => ({})) };
  db.feedbackReport = { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) };
});

describe('moderateFeedback', () => {
  it('HIDE removes the review from item and canteen aggregates, rounding to one decimal', async () => {
    const out = await moderateFeedback(scope, ID, ADMIN, 'HIDE', 'spam review');
    expect(out.changed).toBe(true);
    expect(menu).toEqual({ ratingSum: 5, totalRatings: 1, avgRating: 5 });
    expect(canteen).toEqual({ ratingSum: 9, totalRatings: 2, avgRating: 4.5 });
    expect(rows[ID].moderation).toBe('HIDDEN');
    expect(tx.feedbackEvent.create.mock.calls[0][0].data.type).toBe('moderated');
  });

  it('is idempotent: hiding twice never subtracts twice', async () => {
    await moderateFeedback(scope, ID, ADMIN, 'HIDE', 'spam review');
    const again = await moderateFeedback(scope, ID, ADMIN, 'HIDE', 'spam review');
    expect(again.changed).toBe(false);
    expect(menu.totalRatings).toBe(1);
    expect(canteen.totalRatings).toBe(2);
  });

  it('a lost race on the conditional update fails with 409 and changes no aggregate', async () => {
    const stale = { ...rows[ID] }; // stale read: still CLEAN
    db.feedback.findFirst = vi.fn(async () => stale);
    rows[ID].moderation = 'HIDDEN'; // someone else hid it meanwhile
    await expect(moderateFeedback(scope, ID, ADMIN, 'HIDE', 'spam review')).rejects.toMatchObject({ status: 409 });
    expect(tx.menuItem.update).not.toHaveBeenCalled();
  });

  it('CLEAR on a hidden review re-adds it once and restores the average', async () => {
    await moderateFeedback(scope, ID, ADMIN, 'HIDE', 'spam review');
    await moderateFeedback(scope, ID, ADMIN, 'CLEAR', 'looked again');
    await moderateFeedback(scope, ID, ADMIN, 'CLEAR', 'looked again');
    expect(menu).toEqual({ ratingSum: 9, totalRatings: 2, avgRating: 4.5 });
    expect(canteen).toEqual({ ratingSum: 13, totalRatings: 3, avgRating: 4.3 });
  });

  it('FLAG does not touch aggregates', async () => {
    await moderateFeedback(scope, ID, ADMIN, 'FLAG', 'looks odd');
    expect(rows[ID].moderation).toBe('FLAGGED');
    expect(tx.menuItem.update).not.toHaveBeenCalled();
  });

  it('requires a reason and treats out-of-scope as 404', async () => {
    await expect(moderateFeedback(scope, ID, ADMIN, 'HIDE', ' ')).rejects.toMatchObject({ status: 400 });
    await expect(moderateFeedback({ institutionId: 'other' }, ID, ADMIN, 'HIDE', 'spam review')).rejects.toMatchObject({ status: 404 });
  });

  it('rounds half-up to one decimal', () => {
    expect(computeAvg(13, 3)).toBe(4.3);
    expect(computeAvg(5, 1)).toBe(5);
    expect(computeAvg(0, 0)).toBe(0);
  });
});

describe('bulkUpdate', () => {
  it('reports per-row results, missing rows as Not found, and writes an event per applied row', async () => {
    delete rows[ID2];
    const out = await bulkUpdate(scope, ADMIN, { ids: [ID, ID2], action: 'SET_STATUS', value: 'RESOLVED' });
    expect(out.results).toEqual([{ id: ID, ok: true }, { id: ID2, ok: false, error: 'Not found' }]);
    expect(out.applied).toBe(1);
    expect(tx.feedbackEvent.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create).toHaveBeenCalledTimes(1); // student notified of the status change
    expect(tx.feedback.findMany.mock.calls[0][0].where.institutionId).toBe('inst-1'); // scope applied to the lookup
  });

  it('a stale row fails alone while the others apply', async () => {
    const orig = tx.feedback.updateMany.getMockImplementation();
    tx.feedback.updateMany.mockImplementation(async (a: any) => (a.where.id === ID ? { count: 0 } : orig(a)));
    const out = await bulkUpdate(scope, ADMIN, { ids: [ID, ID2], action: 'SET_PRIORITY', value: 'HIGH' });
    expect(out.results[0]).toMatchObject({ id: ID, ok: false });
    expect(out.results[1]).toEqual({ id: ID2, ok: true });
  });

  it('bulk HIDE reverses aggregates once per row and skips already hidden rows', async () => {
    rows[ID2].moderation = 'HIDDEN';
    const out = await bulkUpdate(scope, ADMIN, { ids: [ID, ID2], action: 'HIDE', reason: 'spam wave' });
    expect(out.results[0].ok).toBe(true);
    expect(out.results[1]).toMatchObject({ ok: false, error: 'Already in that state' });
    expect(menu.totalRatings).toBe(1);
  });

  it('validates the value and the reason up front', async () => {
    await expect(bulkUpdate(scope, ADMIN, { ids: [ID], action: 'SET_STATUS', value: 'NOPE' })).rejects.toMatchObject({ status: 400 });
    await expect(bulkUpdate(scope, ADMIN, { ids: [ID], action: 'SET_STATUS', value: 'WONT_FIX' })).rejects.toMatchObject({ status: 400 });
    await expect(bulkUpdate(scope, ADMIN, { ids: [ID], action: 'HIDE' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('reports', () => {
  it('one report per user and feedback: the unique violation becomes 409', async () => {
    db.feedback.findFirst = vi.fn(async () => ({ id: ID }));
    db.feedbackReport.create = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ code: 'P2002' });
    await expect(reportFeedback(STUDENT, ID, 'rude reply')).resolves.toEqual({ success: true });
    await expect(reportFeedback(STUDENT, ID, 'rude reply')).rejects.toMatchObject({ status: 409 });
  });

  it('404 when the feedback is not visible to the reporter', async () => {
    db.feedback.findFirst = vi.fn(async () => null);
    await expect(reportFeedback(STUDENT, ID, 'rude reply')).rejects.toMatchObject({ status: 404 });
    expect(db.feedback.findFirst.mock.calls[0][0].where).toMatchObject({ id: ID, userId: STUDENT });
  });

  it('lists open reports within scope and omits the reporter', async () => {
    await listReports(scope);
    const arg = db.feedbackReport.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ resolvedAt: null, feedback: { deletedAt: null, institutionId: 'inst-1' } });
    expect(JSON.stringify(arg.select)).not.toContain('reporterId');
  });
});
