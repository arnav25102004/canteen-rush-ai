/**
 * Admin feedback flows against a real Postgres. Skipped unless TEST_DATABASE_URL points at a
 * throwaway database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('admin feedback (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const svc = await import('./feedbackAdmin.service');
  const tag = `fa${Date.now()}`;
  let instId = '';
  let otherInstId = '';
  let adminId = '';
  let studentId = '';
  let canteenId = '';
  const made: string[] = [];

  async function feedback(over: Record<string, unknown> = {}) {
    const f = await prisma.feedback.create({
      data: {
        kind: 'APP_BUG', institutionId: instId, userId: studentId, canteenId, overallRating: 2,
        body: 'payment failed', tags: ['payment'], clientRequestId: randomUUID(), ...over,
      } as any,
    });
    made.push(f.id);
    return f;
  }

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } as any });
    const other = await prisma.institution.create({ data: { name: `${tag}o`, slug: `${tag}o`, emailDomain: `${tag}o.edu` } as any });
    instId = inst.id; otherInstId = other.id;
    const mk = (role: string, n: string, institutionId = instId) => prisma.user.create({
      data: { firebaseUid: `${tag}-${n}`, email: `${tag}-${n}@t.in`, name: n, role, institutionId } as any,
    });
    adminId = (await mk('ADMIN', 'admin')).id;
    studentId = (await mk('STUDENT', 'student')).id;
    canteenId = (await prisma.canteen.create({ data: { name: tag, campus: "C", openingTime: "07:00", closingTime: "20:00", institutionId: instId } as any })).id;
  });

  afterAll(async () => {
    await prisma.feedbackEvent.deleteMany({ where: { feedbackId: { in: made } } });
    await prisma.notification.deleteMany({ where: { userId: studentId } });
    await prisma.feedback.deleteMany({ where: { id: { in: made } } });
    await prisma.canteen.deleteMany({ where: { id: canteenId } });
    await prisma.user.deleteMany({ where: { firebaseUid: { startsWith: tag } } });
    await prisma.institution.deleteMany({ where: { id: { in: [instId, otherInstId] } } });
    await prisma.$disconnect();
  });

  it('opens RECEIVED to SEEN once and records the event', async () => {
    const f = await feedback();
    await svc.getFeedbackDetail({ institutionId: instId }, f.id, adminId);
    const out = await svc.getFeedbackDetail({ institutionId: instId }, f.id, adminId);
    expect(out.feedback.status).toBe('SEEN');
    expect(out.feedback.firstSeenAt).not.toBeNull();
    expect(out.feedback.timeline.filter((e) => e.toStatus === 'SEEN')).toHaveLength(1);
  });

  it('is invisible to another institution', async () => {
    const f = await feedback();
    await expect(svc.getFeedbackDetail({ institutionId: otherInstId }, f.id, adminId)).rejects.toMatchObject({ status: 404 });
    const list = await svc.listFeedback({ institutionId: otherInstId }, { limit: 50 });
    expect(list.feedback.find((r) => r.id === f.id)).toBeUndefined();
  });

  it('two admins racing: exactly one wins, the other gets 409', async () => {
    const f = await feedback({ status: 'SEEN' });
    const scope = { institutionId: instId };
    const results = await Promise.allSettled([
      svc.updateFeedback(scope, f.id, adminId, { status: 'IN_PROGRESS' as any, expectedStatus: 'SEEN' as any }),
      svc.updateFeedback(scope, f.id, adminId, { status: 'RESOLVED' as any, expectedStatus: 'SEEN' as any }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.status).toBe(409);
  });

  it('never returns the author of anonymous feedback and paginates by cursor', async () => {
    const a = await feedback({ isAnonymous: true, status: 'SEEN' });
    const out: any = await svc.getFeedbackDetail({ institutionId: instId }, a.id, adminId);
    expect(out.feedback.author).toBeNull();
    expect(JSON.stringify(out)).not.toContain(studentId);

    const p1 = await svc.listFeedback({ institutionId: instId }, { limit: 2 });
    expect(p1.feedback.length).toBe(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await svc.listFeedback({ institutionId: instId }, { limit: 2, cursor: p1.nextCursor! });
    const ids1 = new Set(p1.feedback.map((r) => r.id));
    expect(p2.feedback.every((r) => !ids1.has(r.id))).toBe(true);
    expect(JSON.stringify(p1)).not.toContain(studentId);
  });
});
