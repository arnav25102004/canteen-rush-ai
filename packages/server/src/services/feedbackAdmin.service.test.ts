import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({}));
vi.mock('../config/database', () => ({ prisma: db }));
const sendPush = vi.hoisted(() => vi.fn());
vi.mock('../config/firebase', () => ({ sendPushNotification: sendPush }));

import {
  buildListWhere, getFeedbackDetail, updateFeedback, addReply, addNote, encodeCursor, decodeCursor,
} from './feedbackAdmin.service';
import { notifyUser } from './notification.service';
import { studentView } from './feedback.service';

const ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const INST = 'inst-1';
const NOW = new Date('2026-11-18T12:00:00Z');
const scope = { institutionId: INST };

let tx: any;
let fb: any;

function setup(over: any = {}) {
  fb = {
    id: ID, status: 'RECEIVED', priority: 'NORMAL', userId: STUDENT, isAnonymous: false, firstSeenAt: null,
    createdAt: NOW, assignedTo: null, duplicateOfId: null, tags: [], moderation: 'CLEAN', ...over,
  };
  tx = {
    feedback: { updateMany: vi.fn(async () => ({ count: 1 })) },
    feedbackEvent: { create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({ count: 1 })) },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(tx));
  db.feedback = { findFirst: vi.fn(async () => fb), findMany: vi.fn(async () => []) };
  db.feedbackEvent = {
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }: any) => ({ id: 'ev1', createdAt: NOW, ...data })),
  };
  db.rating = { findMany: vi.fn(async () => []) };
  db.feedbackAttachment = { findMany: vi.fn(async () => []) };
  db.user = {
    findUnique: vi.fn(async () => ({ id: STUDENT, name: 'Asha', email: 'a@x.in', fcmToken: null })),
    findFirst: vi.fn(async () => ({ id: ADMIN })),
  };
  db.canteen = { findUnique: vi.fn(async () => ({ id: 'c', name: 'Main' })) };
  db.notification = { create: vi.fn(async () => ({})) };
}

beforeEach(() => { vi.clearAllMocks(); sendPush.mockReset(); setup(); });

describe('buildListWhere', () => {
  it('always applies the caller scope, even over a client canteen filter', () => {
    const w: any = buildListWhere({ institutionId: INST }, { limit: 10, canteenId: 'other', kind: 'APP_BUG' as any });
    expect(w.institutionId).toBe(INST);
    expect(w.deletedAt).toBeNull();
    expect(w.kind).toBe('APP_BUG');
  });
  it('cannot be widened: scope keys win over filters', () => {
    const w: any = buildListWhere({ canteenId: 'mine' }, { limit: 10, canteenId: 'other' });
    expect(w.canteenId).toBe('mine');
  });
  it('turns IST dates into absolute bounds, end date inclusive', () => {
    const w: any = buildListWhere({}, { limit: 10, from: '2026-11-01', to: '2026-11-02' });
    expect(w.createdAt.gte.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(w.createdAt.lt.toISOString()).toBe('2026-11-02T18:30:00.000Z');
  });
  it('round-trips a cursor and rejects junk', () => {
    const c = decodeCursor(encodeCursor(NOW, ID));
    expect(c.id).toBe(ID);
    expect(c.createdAt.getTime()).toBe(NOW.getTime());
    expect(() => decodeCursor('###')).toThrow();
  });
});

describe('opening an item', () => {
  it('moves RECEIVED to SEEN, sets firstSeenAt, writes an event and scopes the update', async () => {
    db.feedback.findFirst.mockResolvedValueOnce({ ...fb }).mockResolvedValueOnce({ ...fb, status: 'SEEN', firstSeenAt: NOW });
    const out = await getFeedbackDetail(scope, ID, ADMIN, NOW);
    expect(tx.feedback.updateMany).toHaveBeenCalledWith({
      where: { id: ID, institutionId: INST, status: 'RECEIVED' },
      data: { status: 'SEEN', firstSeenAt: NOW },
    });
    expect(tx.feedbackEvent.create.mock.calls[0][0].data).toMatchObject({ fromStatus: 'RECEIVED', toStatus: 'SEEN' });
    expect(out.feedback.status).toBe('SEEN');
    expect(db.notification.create).toHaveBeenCalled(); // author is told
  });
  it('does not touch an item that is already SEEN', async () => {
    setup({ status: 'SEEN' });
    await getFeedbackDetail(scope, ID, ADMIN, NOW);
    expect(tx.feedback.updateMany).not.toHaveBeenCalled();
  });
  it('treats out-of-scope as 404', async () => {
    db.feedback.findFirst.mockResolvedValue(null);
    await expect(getFeedbackDetail(scope, ID, ADMIN)).rejects.toMatchObject({ status: 404 });
    expect(db.feedback.findFirst.mock.calls[0][0].where).toMatchObject({ id: ID, institutionId: INST });
  });
});

describe('anonymous feedback', () => {
  it('never returns identity and never even looks the user up', async () => {
    setup({ status: 'SEEN', isAnonymous: true });
    const out: any = await getFeedbackDetail(scope, ID, ADMIN, NOW);
    expect(out.feedback.author).toBeNull();
    expect(JSON.stringify(out)).not.toContain(STUDENT);
    expect(JSON.stringify(out)).not.toContain('a@x.in');
    expect(db.user.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: STUDENT } }));
  });
  it('still notifies the author of a public reply', async () => {
    setup({ status: 'SEEN', isAnonymous: true });
    await addReply(scope, ID, ADMIN, 'Thanks, fixed.');
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ userId: STUDENT, type: 'feedback_update' });
    expect(db.feedbackEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'reply', isInternal: false });
  });
  it('shows identity for non-anonymous feedback', async () => {
    setup({ status: 'SEEN' });
    const out: any = await getFeedbackDetail(scope, ID, ADMIN, NOW);
    expect(out.feedback.author).toMatchObject({ id: STUDENT });
  });
});

describe('updateFeedback', () => {
  it('409 when the client saw an older status', async () => {
    setup({ status: 'IN_PROGRESS' });
    await expect(updateFeedback(scope, ID, ADMIN, { status: 'RESOLVED' as any, expectedStatus: 'SEEN' as any }))
      .rejects.toMatchObject({ status: 409, code: 'STALE_STATUS' });
    expect(tx.feedback.updateMany).not.toHaveBeenCalled();
  });
  it('409 when another admin wins the race (conditional update matches nothing)', async () => {
    setup({ status: 'SEEN' });
    tx.feedback.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateFeedback(scope, ID, ADMIN, { status: 'IN_PROGRESS' as any, expectedStatus: 'SEEN' as any }))
      .rejects.toMatchObject({ status: 409, code: 'STALE_STATUS' });
    expect(tx.feedbackEvent.createMany).not.toHaveBeenCalled();
  });
  it.each(['WONT_FIX', 'DUPLICATE'])('%s requires a reason', async (status) => {
    setup({ status: 'SEEN' });
    await expect(updateFeedback(scope, ID, ADMIN, { status: status as any, expectedStatus: 'SEEN' as any }))
      .rejects.toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
    await expect(updateFeedback(scope, ID, ADMIN, { status: status as any, expectedStatus: 'SEEN' as any, reason: ' x ' }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
  it('writes a conditional update, an event and sets resolvedAt', async () => {
    setup({ status: 'IN_PROGRESS' });
    await updateFeedback(scope, ID, ADMIN, { status: 'RESOLVED' as any, expectedStatus: 'IN_PROGRESS' as any }, NOW);
    const call = tx.feedback.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: ID, institutionId: INST, status: 'IN_PROGRESS' });
    expect(call.data).toMatchObject({ status: 'RESOLVED', resolvedAt: NOW });
    expect(tx.feedbackEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({ fromStatus: 'IN_PROGRESS', toStatus: 'RESOLVED' });
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ type: 'feedback_update', userId: STUDENT });
  });
  it('reopening clears resolvedAt', async () => {
    setup({ status: 'RESOLVED' });
    await updateFeedback(scope, ID, ADMIN, { status: 'IN_PROGRESS' as any, expectedStatus: 'RESOLVED' as any }, NOW);
    expect(tx.feedback.updateMany.mock.calls[0][0].data.resolvedAt).toBeNull();
  });
  it('a priority change moves the SLA deadline', async () => {
    setup({ status: 'SEEN' });
    await updateFeedback(scope, ID, ADMIN, { priority: 'URGENT' as any }, NOW);
    expect(tx.feedback.updateMany.mock.calls[0][0].data.slaDueAt.getTime()).toBe(NOW.getTime() + 4 * 3600 * 1000);
  });
  it('rejects an assignee outside the institution', async () => {
    setup({ status: 'SEEN' });
    db.user.findFirst.mockResolvedValue(null);
    await expect(updateFeedback(scope, ID, ADMIN, { assignedTo: ADMIN })).rejects.toMatchObject({ status: 400 });
    expect(db.user.findFirst.mock.calls[0][0].where).toMatchObject({ institutionId: INST });
  });
  it('a notification failure does not fail the update', async () => {
    setup({ status: 'SEEN' });
    db.notification.create.mockRejectedValue(new Error('db down'));
    await expect(updateFeedback(scope, ID, ADMIN, { status: 'IN_PROGRESS' as any, expectedStatus: 'SEEN' as any })).resolves.toBeTruthy();
  });
  it('404 for out-of-scope items', async () => {
    db.feedback.findFirst.mockResolvedValue(null);
    await expect(updateFeedback(scope, ID, ADMIN, { priority: 'HIGH' as any })).rejects.toMatchObject({ status: 404 });
  });
});

describe('notes', () => {
  it('are internal events and notify nobody', async () => {
    await addNote(scope, ID, ADMIN, 'call the vendor');
    expect(db.feedbackEvent.create.mock.calls[0][0].data).toMatchObject({ type: 'note', isInternal: true });
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});

describe('notifyUser', () => {
  it('always writes the in-app row, and pushes when there is a token', async () => {
    db.user.findUnique.mockResolvedValue({ fcmToken: 'tok' });
    await notifyUser(STUDENT, { title: 'T', body: 'B', type: 'feedback_update', data: { feedbackId: ID } });
    expect(db.notification.create).toHaveBeenCalledOnce();
    expect(sendPush).toHaveBeenCalledWith('tok', 'T', 'B', { type: 'feedback_update', feedbackId: ID });
  });
  it('push failure never breaks the call', async () => {
    db.user.findUnique.mockResolvedValue({ fcmToken: 'tok' });
    sendPush.mockRejectedValue(new Error('fcm down'));
    await expect(notifyUser(STUDENT, { title: 'T', body: 'B', type: 'x' })).resolves.toBeUndefined();
    expect(db.notification.create).toHaveBeenCalledOnce();
  });
  it('no token: row only', async () => {
    await notifyUser(STUDENT, { title: 'T', body: 'B', type: 'x' });
    expect(sendPush).not.toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalledOnce();
  });
});

describe('what the author sees', () => {
  it('has public replies and status changes but never notes, actors or reasons', () => {
    const v: any = studentView({
      id: ID, status: 'SEEN', createdAt: NOW, tags: [],
      events: [
        { type: 'note', isInternal: true, note: 'secret', actorId: ADMIN, createdAt: NOW },
        { type: 'reply', isInternal: false, note: 'Fixed it', actorId: ADMIN, createdAt: NOW },
        { type: 'status_changed', isInternal: false, toStatus: 'WONT_FIX', note: 'internal reason', actorId: ADMIN, createdAt: NOW },
        { type: 'assigned', isInternal: true, createdAt: NOW },
      ],
    });
    expect(v.status).toBe('SEEN');
    expect(v.timeline).toHaveLength(2);
    const json = JSON.stringify(v);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('internal reason');
    expect(json).not.toContain(ADMIN);
    expect(v.timeline[0].reply).toBe('Fixed it');
  });
});
