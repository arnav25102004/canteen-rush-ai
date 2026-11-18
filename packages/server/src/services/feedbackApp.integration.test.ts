/**
 * App feedback against a real Postgres. Skipped unless TEST_DATABASE_URL points at a throwaway
 * database with migrations applied (see order.integration.test.ts for setup).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

describe.skipIf(!url)('app feedback (Postgres)', async () => {
  const { prisma } = await import('../config/database');
  const svc = await import('./feedback.service');
  const tag = `a${Date.now()}`;
  let userId = '';
  let newUserId = '';

  const input = (extra: object = {}) => ({
    clientRequestId: randomUUID(), kind: 'APP_BUG' as const, severity: 'PAYMENT_ISSUE' as const,
    body: 'Payment went through but the order did not appear', ...extra,
  });

  beforeAll(async () => {
    const inst = await prisma.institution.create({ data: { name: tag, slug: tag, emailDomain: `${tag}.edu` } });
    userId = (await prisma.user.create({
      data: { firebaseUid: tag, email: `s@${tag}.edu`, name: 'S', role: 'STUDENT', institutionId: inst.id, createdAt: new Date(Date.now() - 3 * 86400000) },
    })).id;
    newUserId = (await prisma.user.create({
      data: { firebaseUid: `${tag}n`, email: `n@${tag}.edu`, name: 'N', role: 'STUDENT', institutionId: inst.id },
    })).id;
  });

  it('stores an URGENT payment bug and is idempotent', async () => {
    const i = input();
    const a = await svc.createAppFeedback(userId, i as any);
    const b = await svc.createAppFeedback(userId, i as any);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.feedback.id).toBe(a.feedback.id);
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: a.feedback.id } });
    expect(row.priority).toBe('URGENT');
    expect(row.slaDueAt).not.toBeNull();
  });

  it('caps app feedback at 3 per 24h even under parallel requests', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => svc.createAppFeedback(userId, input({ kind: 'APP_OTHER', severity: undefined, body: 'hello there' }) as any)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const total = await prisma.feedback.count({ where: { userId, kind: { in: ['APP_BUG', 'APP_IDEA', 'APP_PRAISE', 'APP_OTHER'] } } });
    expect(total).toBeLessThanOrEqual(3);
    expect(ok).toBeLessThanOrEqual(3);
  });

  it('refuses accounts younger than 24 hours', async () => {
    await expect(svc.createAppFeedback(newUserId, input() as any)).rejects.toMatchObject({ code: 'ACCOUNT_TOO_NEW' });
  });
});
