import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
const notify = vi.hoisted(() => vi.fn(async (..._a: any[]) => undefined));
vi.mock('../config/database', () => ({ prisma: db }));
vi.mock('./notification.service', () => ({ notifyUser: notify }));

import { claimFirstNudge, claimSecondNudge, runFeedbackNudges } from './feedbackNudge.service';
import { runSlaBreaches } from './feedbackSla.service';
import { velocityVerdict, checkCanteenVelocity, runFeedbackAlerts } from './feedbackAlerts.service';
import {
  toVendorDto, vendorVisibleWhere, replyToFeedback, flagUnfair, listVendorFeedback, istDay, LOW_RATING_DELAY_MS,
} from './vendorFeedback.service';
import { studentView } from './feedback.service';

const NOW = new Date('2026-11-18T06:30:00Z'); // 12:00 IST
const V = { id: 'vendor1', canteenId: 'can1' };
const FB = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  notify.mockClear();
  for (const k of Object.keys(db)) delete db[k];
});

describe('nudge claim', () => {
  it('only one of two runners wins the claim', async () => {
    let sentAt: Date | null = null;
    db.order = {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.feedbackNudgeSentAt === null && sentAt === null) { sentAt = data.feedbackNudgeSentAt; return { count: 1 }; }
        return { count: 0 };
      }),
    };
    const [a, b] = await Promise.all([claimFirstNudge('o1', NOW), claimFirstNudge('o1', NOW)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('claims conditionally on status and an unset column', async () => {
    db.order = { updateMany: vi.fn(async () => ({ count: 1 })) };
    await claimFirstNudge('o1', NOW);
    expect(db.order.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'o1', status: 'PICKED_UP', feedbackNudgeSentAt: null });
    await claimSecondNudge('o1', NOW);
    expect(db.order.updateMany.mock.calls[1][0].where).toMatchObject({ feedbackNudge2SentAt: null });
  });

  it('does not notify when the claim is lost, and skips recently nudged users', async () => {
    db.order = {
      findMany: vi.fn(async () => [{ id: 'o1', userId: 'u1' }, { id: 'o2', userId: 'u2' }]),
      findFirst: vi.fn(async ({ where }: any) => (where.userId === 'u2' ? { id: 'other' } : null)),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    expect(await runFeedbackNudges(NOW)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends a deep-linked nudge once per user per run', async () => {
    db.order = {
      findMany: vi.fn(async () => [{ id: 'o1', userId: 'u1' }, { id: 'o2', userId: 'u1' }]),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    };
    const n = await runFeedbackNudges(NOW);
    expect(n).toBe(1);
    expect(notify).toHaveBeenCalledWith('u1', expect.objectContaining({
      type: 'feedback_nudge', data: { orderId: 'o1', url: 'campuskhana://feedback/order/o1' },
    }));
  });
});

describe('SLA breach', () => {
  function setup(existing = false) {
    const created: any[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      feedbackEvent: {
        findFirst: vi.fn(async () => (existing || created.length ? { id: 'e' } : null)),
        create: vi.fn(async (a: any) => { created.push(a); return {}; }),
      },
    };
    db.feedback = { findMany: vi.fn(async () => [{ id: 'f1', kind: 'APP_BUG', priority: 'URGENT', assignedTo: null, institutionId: 'i1' }]) };
    db.user = { findMany: vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }]) };
    db.$transaction = vi.fn(async (fn: any) => fn(tx));
    return created;
  }

  it('selects only open, unrecorded, overdue items and notifies all admins once', async () => {
    const created = setup();
    expect(await runSlaBreaches(NOW)).toBe(1);
    const where = db.feedback.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['RECEIVED', 'SEEN', 'IN_PROGRESS']);
    expect(where.events).toEqual({ none: { type: 'SLA_BREACH' } });
    expect(created[0].data).toMatchObject({ type: 'SLA_BREACH', isInternal: true });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does nothing when a breach event already exists (concurrent runner)', async () => {
    setup(true);
    expect(await runSlaBreaches(NOW)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies only the assignee when there is one', async () => {
    setup();
    db.feedback.findMany = vi.fn(async () => [{ id: 'f1', kind: 'APP_BUG', priority: 'HIGH', assignedTo: 'boss', institutionId: 'i1' }]);
    await runSlaBreaches(NOW);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toBe('boss');
  });
});

describe('alerts', () => {
  it('velocity verdict: 3 in a day, or 5x the mean with at least 2', () => {
    expect(velocityVerdict(3, 0)).toBe(true);
    expect(velocityVerdict(2, 0)).toBe(true); // 2 >= 5 * 0
    expect(velocityVerdict(1, 0)).toBe(false);
    expect(velocityVerdict(2, 30)).toBe(false); // mean 1/day, needs 5
    expect(velocityVerdict(2, 6)).toBe(true); // mean 0.2/day, 5x = 1
  });

  function velocitySetup(seen: boolean, count24h = 3) {
    const created: any[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      feedbackEvent: {
        findFirst: vi.fn(async () => (seen || created.length ? { id: 'e' } : null)),
        create: vi.fn(async (a: any) => { created.push(a); return {}; }),
      },
    };
    db.feedback = {
      count: vi.fn(async ({ where }: any) => (where.createdAt.lt ? 0 : count24h)),
      updateMany: vi.fn(async () => ({ count: count24h })),
    };
    db.user = { findMany: vi.fn(async () => [{ id: 'a1' }]) };
    db.$transaction = vi.fn(async (fn: any) => fn(tx));
    return created;
  }

  it('flags recent 1-star rows and alerts admins once per canteen per 24h', async () => {
    const created = velocitySetup(false);
    expect(await checkCanteenVelocity(FB, 'can1', 'i1', NOW)).toBe(true);
    expect(db.feedback.updateMany.mock.calls[0][0].data).toEqual({ moderation: 'FLAGGED' });
    expect(created[0].data).toMatchObject({ type: 'VELOCITY_ALERT', data: { canteenId: 'can1' } });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not alert again inside 24h but still flags', async () => {
    velocitySetup(true);
    await checkCanteenVelocity(FB, 'can1', 'i1', NOW);
    expect(db.feedback.updateMany).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing below the threshold', async () => {
    velocitySetup(false, 1);
    expect(await checkCanteenVelocity(FB, 'can1', 'i1', NOW)).toBe(false);
    expect(db.feedback.updateMany).not.toHaveBeenCalled();
  });

  it('alerts for a 1-star review with text and an urgent bug, never throws', async () => {
    db.user = { findMany: vi.fn(async () => [{ id: 'a1' }]) };
    db.feedback = { findUnique: vi.fn(async () => ({ id: FB, kind: 'APP_BUG', priority: 'URGENT', overallRating: null, body: 'x', canteenId: null, institutionId: 'i1' })) };
    await runFeedbackAlerts(FB, NOW);
    expect(notify).toHaveBeenCalledTimes(1);
    db.feedback.findUnique = vi.fn(async () => { throw new Error('db down'); });
    await expect(runFeedbackAlerts(FB, NOW)).resolves.toBeUndefined();
  });
});

describe('vendor DTO', () => {
  const row = {
    id: 'f1', kind: 'ORDER_REVIEW', overallRating: 2, tags: ['cold'], body: 'call 9876543210', bodyRedacted: 'call [phone removed]',
    createdAt: new Date('2026-11-18T20:45:12Z'),
    // Fields that must never leak, even if a query accidentally selected them.
    userId: 'u1', orderId: 'o1', isAnonymous: false, shareNameWithCanteen: true, assignedTo: 'x', contextJson: { a: 1 }, slotId: 's1',
    user: { name: 'Asha', email: 'a@x.edu' }, order: { orderNumber: 'CR-1', slot: { startTime: '12:00' } },
    ratings: [{ rating: 1, taste: 2, portion: null, value: null, tags: [], menuItem: { name: 'Dosa' }, userId: 'u1', orderId: 'o1' }],
    attachments: [{ url: 'https://img/ok.jpg', status: 'APPROVED' }, { url: 'https://img/no.jpg', status: 'PENDING' }],
    events: [{ type: 'REPLY_PUBLIC', note: 'Sorry!', data: { by: 'Main Canteen' }, createdAt: new Date('2026-11-19T01:00:00Z'), actorId: 'vendor1' }],
  };

  function allKeys(o: any, out = new Set<string>()): Set<string> {
    if (Array.isArray(o)) o.forEach((x) => allKeys(x, out));
    else if (o && typeof o === 'object' && !(o instanceof Date)) for (const [k, v] of Object.entries(o)) { out.add(k); allKeys(v, out); }
    return out;
  }

  it('contains no identity or timing keys and no exact time', () => {
    const dto = toVendorDto(row);
    const keys = allKeys(dto);
    for (const banned of ['userId', 'user', 'name', 'email', 'orderId', 'order', 'orderNumber', 'slot', 'slotId', 'isAnonymous',
      'shareNameWithCanteen', 'assignedTo', 'contextJson', 'createdAt', 'actorId', 'body', 'bodyRedacted']) {
      expect(keys.has(banned), banned).toBe(false);
    }
    const json = JSON.stringify(dto);
    expect(json).not.toContain('Asha');
    expect(json).not.toContain('9876543210');
    expect(json).not.toContain('20:45');
    expect(json).not.toContain('T20');
  });

  it('shows redacted text, approved photos only, the IST day and the reply', () => {
    const dto = toVendorDto(row);
    expect(dto.text).toBe('call [phone removed]');
    expect(dto.photos).toEqual(['https://img/ok.jpg']);
    expect(dto.day).toBe('2026-11-19'); // 20:45Z is already the next day in IST
    expect(dto.reply).toEqual({ text: 'Sorry!', by: 'Main Canteen', day: '2026-11-19' });
    expect(dto.items[0]).toMatchObject({ item: 'Dosa', rating: 1 });
  });

  it('is identical for anonymous and named reviews', () => {
    const a = toVendorDto({ ...row, isAnonymous: true, userId: null });
    const b = toVendorDto({ ...row, isAnonymous: false, userId: 'u9', shareNameWithCanteen: true });
    expect(a).toEqual(b);
  });

  it('redacts on the fly when no stored redaction exists', () => {
    expect(toVendorDto({ ...row, bodyRedacted: null }).text).toBe('call [phone removed]');
  });
});

describe('vendor visibility', () => {
  it('delays 1-2 star items by 3 hours and scopes to the canteen', () => {
    const w: any = vendorVisibleWhere('can1', NOW);
    expect(w.canteenId).toBe('can1');
    expect(w.visibility.in).not.toContain('ADMIN_ONLY');
    expect(w.moderation).toEqual({ not: 'HIDDEN' });
    expect(w.OR).toContainEqual({ overallRating: { gte: 3 } });
    expect(w.OR).toContainEqual({ createdAt: { lte: new Date(NOW.getTime() - LOW_RATING_DELAY_MS) } });
    expect(LOW_RATING_DELAY_MS).toBe(3 * 3600 * 1000);
  });

  it('list uses the visibility filter and a select that excludes identity', async () => {
    db.feedback = { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) };
    await listVendorFeedback('can1', 1, 20, NOW);
    const args = db.feedback.findMany.mock.calls[0][0];
    expect(args.where.canteenId).toBe('can1');
    const sel = JSON.stringify(args.select);
    for (const k of ['userId', 'orderId', 'user"', 'order"', 'slot', 'isAnonymous', 'contextJson']) expect(sel).not.toContain(k);
  });

  it('istDay uses the Indian calendar day', () => {
    expect(istDay(new Date('2026-11-18T18:29:00Z'))).toBe('2026-11-18');
    expect(istDay(new Date('2026-11-18T18:31:00Z'))).toBe('2026-11-19');
  });
});

describe('vendor reply', () => {
  function setup(existing = false) {
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      feedbackEvent: {
        findFirst: vi.fn(async () => (existing ? { id: 'e' } : null)),
        create: vi.fn(async (a: any) => ({ ...a.data, createdAt: NOW })),
      },
    };
    db.feedback = { findFirst: vi.fn(async () => ({ id: FB, userId: 'student1' })) };
    db.canteen = { findUnique: vi.fn(async () => ({ name: 'Main Canteen' })) };
    db.$transaction = vi.fn(async (fn: any) => fn(tx));
    return tx;
  }

  it('stores a public reply with a canteen snapshot and notifies the student', async () => {
    const tx = setup();
    const r = await replyToFeedback(V, FB, 'Thanks for the feedback', NOW);
    const data = tx.feedbackEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: 'REPLY_PUBLIC', isInternal: false, actorId: 'vendor1', data: { by: 'Main Canteen' } });
    expect(r.reply.by).toBe('Main Canteen');
    expect(notify).toHaveBeenCalledWith('student1', expect.objectContaining({ type: 'feedback_update' }));
  });

  it('allows only one reply', async () => {
    setup(true);
    await expect(replyToFeedback(V, FB, 'Again', NOW)).rejects.toMatchObject({ status: 409, code: 'REPLY_EXISTS' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects empty and over-300 replies, and masks profanity and PII', async () => {
    const tx = setup();
    await expect(replyToFeedback(V, FB, '   ', NOW)).rejects.toMatchObject({ status: 400 });
    await expect(replyToFeedback(V, FB, 'a'.repeat(301), NOW)).rejects.toMatchObject({ status: 400 });
    await replyToFeedback(V, FB, 'call 9876543210 you shit', NOW);
    const note = tx.feedbackEvent.create.mock.calls[0][0].data.note;
    expect(note).not.toContain('9876543210');
    expect(note).not.toContain('shit');
  });

  it('404s for feedback outside the vendor visibility filter', async () => {
    setup();
    db.feedback.findFirst = vi.fn(async () => null);
    await expect(replyToFeedback(V, FB, 'hi', NOW)).rejects.toMatchObject({ status: 404 });
    expect(db.feedback.findFirst.mock.calls[0][0].where.canteenId).toBe('can1');
  });
});

describe('flag unfair', () => {
  it('creates a report and an internal event, hiding nothing', async () => {
    const tx = { feedbackReport: { create: vi.fn() }, feedbackEvent: { create: vi.fn() } };
    db.feedback = { findFirst: vi.fn(async () => ({ id: FB, userId: 'u' })), update: vi.fn(), updateMany: vi.fn() };
    db.$transaction = vi.fn(async (fn: any) => fn(tx));
    const r = await flagUnfair(V, FB, 'This is not true', NOW);
    expect(r).toEqual({ flagged: true, alreadyFlagged: false });
    expect(tx.feedbackReport.create.mock.calls[0][0].data).toMatchObject({ feedbackId: FB, reporterId: 'vendor1' });
    expect(tx.feedbackEvent.create.mock.calls[0][0].data.isInternal).toBe(true);
    expect(db.feedback.update).not.toHaveBeenCalled();
    expect(db.feedback.updateMany).not.toHaveBeenCalled();
  });
});

describe('student timeline', () => {
  it('shows the vendor reply to the author as a reply from the canteen, without internals', () => {
    const v = studentView({
      id: 'f', createdAt: NOW,
      events: [
        { type: 'REPLY_PUBLIC', note: 'Sorry!', isInternal: false, createdAt: NOW },
        { type: 'SLA_BREACH', isInternal: true, createdAt: NOW },
        { type: 'vendor_flagged_unfair', isInternal: true, note: 'x', createdAt: NOW },
      ],
    });
    expect(v.timeline).toHaveLength(1);
    expect(v.timeline[0]).toMatchObject({ type: 'reply', reply: 'Sorry!', from: 'canteen' });
  });
});
